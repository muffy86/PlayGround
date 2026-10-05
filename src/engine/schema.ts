/**
 * Minimal Zod → JSON Schema converter for the WebMCP `inputSchema` field.
 *
 * Covers the subset the bridge actually registers (objects, enums, numbers
 * with min/max/int, booleans, optional, default, records). Unsupported nodes
 * throw — a silent `{}` would advertise a tool the runtime cannot validate.
 */
import type { ZodTypeAny } from 'zod';

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: string[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  default?: unknown;
}

interface ZodCheck {
  kind: string;
  value?: number;
  inclusive?: boolean;
}

interface ZodLike {
  description?: string | undefined;
  _def: {
    typeName: string;
    values?: string[];
    value?: unknown;
    checks?: ZodCheck[];
    shape?: () => Record<string, ZodLike>;
    innerType?: ZodLike;
    type?: ZodLike;
    keyType?: ZodLike;
    valueType?: ZodLike;
    defaultValue?: () => unknown;
  };
}

function asZod(schema: ZodTypeAny): ZodLike {
  return schema as unknown as ZodLike;
}

function withDescription(schema: ZodLike, out: JsonSchema): JsonSchema {
  if (schema.description) out.description = schema.description;
  return out;
}

function isOptionalInput(schema: ZodLike): boolean {
  const name = schema._def.typeName;
  return name === 'ZodOptional' || name === 'ZodDefault';
}

export function zodToInputSchema(schema: ZodTypeAny): JsonSchema {
  return convert(asZod(schema));
}

function convert(schema: ZodLike): JsonSchema {
  const def = schema._def;
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const key of Object.keys(shape)) {
        const child = shape[key];
        if (!child) continue;
        properties[key] = convert(child);
        if (!isOptionalInput(child)) required.push(key);
      }
      const out: JsonSchema = { type: 'object', properties, additionalProperties: false };
      if (required.length > 0) out.required = required;
      return withDescription(schema, out);
    }
    case 'ZodString': {
      const out: JsonSchema = { type: 'string' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min' && check.value !== undefined) out.minLength = check.value;
      }
      return withDescription(schema, out);
    }
    case 'ZodNumber': {
      const out: JsonSchema = { type: 'number' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'int') out.type = 'integer';
        if (check.kind === 'min' && check.value !== undefined) out.minimum = check.value;
        if (check.kind === 'max' && check.value !== undefined) out.maximum = check.value;
      }
      return withDescription(schema, out);
    }
    case 'ZodBoolean':
      return withDescription(schema, { type: 'boolean' });
    case 'ZodEnum':
      return withDescription(schema, { type: 'string', enum: [...(def.values ?? [])] });
    case 'ZodLiteral': {
      const value = def.value;
      const type = typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : undefined;
      const out: JsonSchema = { const: value };
      if (type) out.type = type;
      return withDescription(schema, out);
    }
    case 'ZodOptional': {
      if (!def.innerType) throw new TypeError('zodToInputSchema: ZodOptional missing innerType');
      return withDescription(schema, convert(def.innerType));
    }
    case 'ZodDefault': {
      if (!def.innerType) throw new TypeError('zodToInputSchema: ZodDefault missing innerType');
      const inner = convert(def.innerType);
      if (def.defaultValue) inner.default = def.defaultValue();
      return withDescription(schema, inner);
    }
    case 'ZodArray': {
      if (!def.type) throw new TypeError('zodToInputSchema: ZodArray missing type');
      return withDescription(schema, { type: 'array', items: convert(def.type) });
    }
    case 'ZodRecord': {
      const values = def.valueType ? convert(def.valueType) : {};
      return withDescription(schema, { type: 'object', additionalProperties: values });
    }
    case 'ZodUnknown':
    case 'ZodAny':
      return withDescription(schema, {});
    default:
      throw new TypeError(`zodToInputSchema: unsupported Zod node ${def.typeName}`);
  }
}
