import { SchemaCheck, SchemaError } from '../types';

/**
 * A schema rule defines what a valid tool parameter input looks like.
 */
export interface SchemaRule {
  /** Tool name to match */
  tool: string;
  /** Required parameter names */
  required?: string[];
  /** Parameter type constraints */
  types?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
  /** Allowed values for specific parameters */
  allowedValues?: Record<string, unknown[]>;
  /** Min/max constraints */
  min?: Record<string, number>;
  max?: Record<string, number>;
  /** Regex patterns for string validation */
  patterns?: Record<string, string>;
  /** Custom validation functions (returns error message or null) */
  custom?: Record<string, (value: unknown) => string | null>;
}

/**
 * Schema Gate — deterministic parameter validation.
 *
 * Validates tool call parameters against predefined schema rules.
 * Zero LLM dependency. Pure logic. Fails safe.
 */
export class SchemaGate {
  private rules: Map<string, SchemaRule> = new Map();

  /** Register a schema rule for a tool */
  registerRule(rule: SchemaRule): void {
    this.rules.set(rule.tool, rule);
  }

  /** Register multiple rules at once */
  registerRules(rules: SchemaRule[]): void {
    rules.forEach((r) => this.registerRule(r));
  }

  /** Get all registered rules */
  getRules(): SchemaRule[] {
    return Array.from(this.rules.values());
  }

  /** Check if a tool has a registered rule */
  hasRule(tool: string): boolean {
    return this.rules.has(tool);
  }

  /**
   * Validate tool call parameters against its schema rule.
   * Returns { pass: true } if no rule is registered for the tool (allow by default).
   */
  check(tool: string, params: Record<string, unknown>): SchemaCheck {
    const rule = this.rules.get(tool);

    if (!rule) {
      // No rule registered — allow by default (pass-through mode)
      return { pass: true };
    }

    const errors: SchemaError[] = [];

    // 1. Check required params
    if (rule.required) {
      for (const field of rule.required) {
        if (!(field in params) || params[field] === undefined) {
          errors.push({
            field,
            actual: undefined,
            expected: `required`,
            message: `Missing required parameter: ${field}`,
          });
        }
      }
    }

    // 2. Check type constraints
    if (rule.types) {
      for (const [field, expectedType] of Object.entries(rule.types)) {
        if (!(field in params)) continue;

        const value = params[field];
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (actualType !== expectedType) {
          errors.push({
            field,
            actual: value,
            expected: expectedType,
            message: `Expected ${expectedType} for "${field}", got ${actualType}`,
          });
        }
      }
    }

    // 3. Check allowed values
    if (rule.allowedValues) {
      for (const [field, allowed] of Object.entries(rule.allowedValues)) {
        if (!(field in params)) continue;

        const value = params[field];
        if (!allowed.includes(value)) {
          errors.push({
            field,
            actual: value,
            expected: `one of [${allowed.map((v) => JSON.stringify(v)).join(', ')}]`,
            message: `Value "${JSON.stringify(value)}" is not allowed for "${field}"`,
          });
        }
      }
    }

    // 4. Check min/max constraints
    if (rule.min) {
      for (const [field, min] of Object.entries(rule.min)) {
        if (!(field in params)) continue;

        const value = params[field];
        if (typeof value === 'number' && value < min) {
          errors.push({
            field,
            actual: value,
            expected: `>= ${min}`,
            message: `Value ${value} is less than minimum ${min} for "${field}"`,
          });
        }

        if (typeof value === 'string' && value.length < min) {
          errors.push({
            field,
            actual: `length ${value.length}`,
            expected: `length >= ${min}`,
            message: `String "${field}" length ${value.length} is less than minimum ${min}`,
          });
        }

        if (Array.isArray(value) && value.length < min) {
          errors.push({
            field,
            actual: `length ${value.length}`,
            expected: `length >= ${min}`,
            message: `Array "${field}" length ${value.length} is less than minimum ${min}`,
          });
        }
      }
    }

    if (rule.max) {
      for (const [field, max] of Object.entries(rule.max)) {
        if (!(field in params)) continue;

        const value = params[field];
        if (typeof value === 'number' && value > max) {
          errors.push({
            field,
            actual: value,
            expected: `<= ${max}`,
            message: `Value ${value} exceeds maximum ${max} for "${field}"`,
          });
        }

        if (typeof value === 'string' && value.length > max) {
          errors.push({
            field,
            actual: `length ${value.length}`,
            expected: `length <= ${max}`,
            message: `String "${field}" length ${value.length} exceeds maximum ${max}`,
          });
        }

        if (Array.isArray(value) && value.length > max) {
          errors.push({
            field,
            actual: `length ${value.length}`,
            expected: `length <= ${max}`,
            message: `Array "${field}" length ${value.length} exceeds maximum ${max}`,
          });
        }
      }
    }

    // 5. Check regex patterns
    if (rule.patterns) {
      for (const [field, pattern] of Object.entries(rule.patterns)) {
        if (!(field in params)) continue;

        const value = params[field];
        if (typeof value !== 'string') continue;

        try {
          const regex = new RegExp(pattern);
          if (!regex.test(value)) {
            errors.push({
              field,
              actual: value,
              expected: `matches /${pattern}/`,
              message: `"${field}" value does not match required pattern`,
            });
          }
        } catch {
          // Invalid regex — skip
        }
      }
    }

    // 6. Run custom validators
    if (rule.custom) {
      for (const [field, validator] of Object.entries(rule.custom)) {
        if (!(field in params)) continue;

        const errorMsg = validator(params[field]);
        if (errorMsg) {
          errors.push({
            field,
            actual: params[field],
            expected: 'valid',
            message: errorMsg,
          });
        }
      }
    }

    return {
      pass: errors.length === 0,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }
}
