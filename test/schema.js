var _ = require('lodash');
var util = require('util');

var AvroInvalidSchemaError = function(msg) { return new Error('AvroInvalidSchemaError: ' + util.format.apply(null, arguments)); }

var PRIMITIVE_TYPES = ['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string'];
var COMPLEX_TYPES = ['record', 'enum', 'array', 'map', 'union', 'fixed'];

var _parseNamedType = function(schema, namespace) {
    if (_.contains(PRIMITIVE_TYPES, schema)) {
        return schema;
    } else {
        throw new AvroInvalidSchemaError('unknown type name: %s; known type names are ',
                                         JSON.stringify(schema),
                                         JSON.stringify(_.keys(_namedTypes)));
    }
};

function makeFullyQualifiedTypeName(schema, namespace) {
    var typeName = null;
    if (_.isString(schema)) {
        typeName = schema;
    } else if (_.isObject(schema)) {
        if (_.isString(schema.namespace)) {
            namespace = schema.namespace;
        }
        if (_.isString(schema.name)) {
            typeName = schema.name;
        } else if (_.isString(schema.type)) {
            typeName = schema.type;
        }
    } else {
        throw new AvroInvalidSchemaError('unable to determine fully qualified type name from schema %s in namespace %s',
                                         JSON.stringify(schema), namespace);
    }

    if (!_.isString(typeName)) {
        throw new AvroInvalidSchemaError('unable to determine type name from schema %s in namespace %s',
                                         JSON.stringify(schema), namespace);
    }

    if (typeName.indexOf('.') !== -1) {
        return typeName;
    } else if (_.contains(PRIMITIVE_TYPES, typeName)) {
        return typeName;
    } else if (_.isString(namespace)) {
        return namespace + '.' + typeName;
    } else {
        return typeName;
    }
}

function Schema(schema, namespace) {
    this.schemaRecords = {};

    if ((this instanceof arguments.callee) === false)
        return new arguments.callee(schema, namespace);

    if (!_.isUndefined(schema))
        return this.parse(schema, namespace);
}

_.extend(Schema.prototype, {

    parse: function(schema, namespace) {
        var self = this;
        if (_.isNull(schema) || _.isUndefined(schema)) {
            throw new AvroInvalidSchemaError('schema is null, in parentSchema: %s',
                                             JSON.stringify(parentSchema));
        } else if (_.isString(schema)) {
            return new PrimitiveSchema(this, schema);
        } else if (_.isObject(schema) && !_.isArray(schema)) {
            if (schema.type === 'record') {
                if (!_.has(schema, 'fields')) {
                    throw new AvroInvalidSchemaError('record must specify "fields", got %s',
                                                     JSON.stringify(schema));
                } else if (!_.has(schema, 'name')) {
                    throw new AvroInvalidSchemaError('record must specify "name", got %s',
                                                     JSON.stringify(schema));
                } else {
                    var record = new RecordSchema(schema.name, schema.namespace,
                                        _.map(schema.fields, function(field) {
                                            return new FieldSchema(field.name, self.parse(field, namespace));
                                        }));
                    // Store the schema records into a map of schema name to
                    // record, so we can compare against it later if we find
                    // something that isn't a primitive data type, but may
                    // be a self-reference
                    if (!this.schemaRecords[schema.name]) {
                        this.schemaRecords[schema.name] = record;
                    }

                    return record;
                }
            } else if (schema.type === 'enum') {
                if (_.has(schema, 'symbols')) {
                    return new EnumSchema(schema.symbols);
                } else {
                    throw new AvroInvalidSchemaError('enum must specify "symbols", got %s',
                                                     JSON.stringify(schema));
                }
            } else if (schema.type === 'array') {
                if (_.has(schema, 'items')) {
                    return new ArraySchema(this.parse(schema.items, namespace), namespace);
                } else {
                    throw new AvroInvalidSchemaError('array must specify "items", got %s',
                                                     JSON.stringify(schema));
                }
            } else if (schema.type === 'map') {
                if (_.has(schema, 'values')) {
                    return new MapSchema(this.parse(schema.values, namespace));
                } else {
                    throw new AvroInvalidSchemaError('map must specify "values" schema, got %s',
                                                     JSON.stringify(schema));
                }
            } else if (schema.type === 'fixed') {
                if (_.has(schema, 'size')) {
                   return new FixedSchema(schema.name, schema.size);
                } else {
                    throw new AvroInvalidSchemaError('fixed must specify "size", got %s',
                                                         JSON.stringify(schema));
                }
            } else if (_.has(schema, 'type')) {
                return this.parse(schema.type, namespace);
            } else {
                throw new AvroInvalidSchemaError('not yet implemented: %j', schema);
            }
        } else if (_.isArray(schema)) {
            if (_.isEmpty(schema)) {
                throw new AvroInvalidSchemaError('unions must have at least 1 branch');
            }
            var branchTypes = _.map(schema, function(type) {
                return self.parse(type, schema, namespace);
            });
            return new UnionSchema(branchTypes, namespace);
        } else {
            throw new AvroInvalidSchemaError('unexpected Javascript type for schema: ' + (typeof schema));
        }
    },

    validate: function(schema, datum){
        return true;
    },

    validateAndThrow: function(schema, datum){
        return true;
    },

    toString: function() {
        return JSON.stringify({ type: this.type });
    }
});

function PrimitiveSchema(schema, type) {

    if (!_.isString(type)) {
        throw new AvroInvalidSchemaError('Primitive type name must be a string');
    }

    if (!_.contains(PRIMITIVE_TYPES, type)) {
        var record = schema.schemaRecords[type];

        if (record) {
            this.type = record;
            return;
        }

        throw new AvroErrors.InvalidSchemaError('Primitive type must be one of: %s; or a previously self-referenced type. Got %s',
                                         JSON.stringify(PRIMITIVE_TYPES), type);
    }

    this.type = type;
}

util.inherits(PrimitiveSchema, Schema);

function FieldSchema(name, type) {
    if (!_.isString(name)) {
        throw new AvroInvalidSchemaError('Field name must be string');
    }

    if (!(type instanceof Schema)) {
        throw new AvroInvalidSchemaError('Field type must be a Schema object');
    }

    this.name = name;
    this.type = type;
}

//util.inherits(FieldSchema, Schema);

function NamedSchema(name, namespace) {

}

function RecordSchema(name, namespace, fields) {
    if (!_.isString(name)) {
        throw new AvroInvalidSchemaError('Record name must be string');
    }

    if (!_.isNull(namespace) && !_.isUndefined(namespace) && !_.isString(namespace)) {
        throw new AvroInvalidSchemaError('Record namespace must be string or null');
    }

    if (!_.isArray(fields)) {
        throw new AvroInvalidSchemaError('Fields must be an array');
    }

    this.type = 'record';
    this.name = name;
    this.namespace = namespace;
    this.fields = fields;

    this.fieldsHash = _.reduce(fields, function(hash, field) {
        hash[field.name] = field;
        return hash;
    }, {});
};

util.inherits(RecordSchema, Schema);

function MapSchema(type) {
    this.type = 'map';
    this.values = type;
}

util.inherits(MapSchema, Schema);

function ArraySchema(items) {
    if (_.isNull(items) || _.isUndefined(items)) {
        throw new AvroInvalidSchemaError('Array "items" schema should not be null or undefined');
    }

    this.type = 'array';
    this.items = items;
}

util.inherits(ArraySchema, Schema);

function UnionSchema(schemas, namespace) {
    if (!_.isArray(schemas) || _.isEmpty(schemas)) {
        throw new InvalidSchemaError('Union must have at least 1 branch');
    }

    this.type = 'union';
    this.schemas = schemas; //_.map(schemas, function(type) { return makeFullyQualifiedTypeName(type, namespace); });
    this.namespace = namespace;
}

util.inherits(UnionSchema, Schema);

function EnumSchema(symbols) {
    if (!_.isArray(symbols)) {
        throw new AvroInvalidSchemaError('Enum must have array of symbols, got %s',
                                         JSON.stringify(symbols));
    }
    if (!_.all(symbols, function(symbol) { return _.isString(symbol); })) {
        throw new AvroInvalidSchemaError('Enum symbols must be strings, got %s',
                                         JSON.stringify(symbols));
    }

    this.type = 'enum';
    this.symbols = symbols;
}
util.inherits(EnumSchema, Schema);

function FixedSchema(name, size) {

    this.type = 'fixed';
    this.name = name;
    this.size = size;
}

util.inherits(FixedSchema, Schema);

if (!_.isUndefined(exports)) {
    exports.Schema = Schema;
    exports.PrimitiveSchema = PrimitiveSchema;
    exports.ArraySchema = ArraySchema;
    exports.MapSchema = MapSchema;
    exports.UnionSchema = UnionSchema;
    exports.RecordSchema = RecordSchema;
    exports.FixedSchema = FixedSchema;
    exports.EnumSchema = EnumSchema;
}
