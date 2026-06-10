import { SchemaGate, SchemaRule } from '../../src/guard/schema-gate';

describe('SchemaGate', () => {
  let gate: SchemaGate;

  beforeEach(() => {
    gate = new SchemaGate();
  });

  describe('rule registration', () => {
    it('should register a single rule', () => {
      const rule: SchemaRule = { tool: 'write_file', required: ['path', 'content'] };
      gate.registerRule(rule);
      expect(gate.hasRule('write_file')).toBe(true);
    });

    it('should register multiple rules at once', () => {
      gate.registerRules([
        { tool: 'read_file', required: ['path'] },
        { tool: 'exec_command', required: ['command'] },
      ]);
      expect(gate.hasRule('read_file')).toBe(true);
      expect(gate.hasRule('exec_command')).toBe(true);
    });

    it('should override existing rule with same tool name', () => {
      gate.registerRule({ tool: 'api', required: ['url'] });
      gate.registerRule({ tool: 'api', required: ['url', 'method'] });
      const rule = gate.getRules().find((r: SchemaRule) => r.tool === 'api');
      expect(rule?.required).toEqual(['url', 'method']);
    });

    it('should list all registered rules', () => {
      gate.registerRules([
        { tool: 'a', required: [] },
        { tool: 'b', required: [] },
      ]);
      expect(gate.getRules()).toHaveLength(2);
    });
  });

  describe('pass-through (no rule)', () => {
    it('should pass when no rule is registered for a tool', () => {
      const result = gate.check('unknown_tool', { foo: 'bar' });
      expect(result.pass).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe('required parameter check', () => {
    it('should fail when a required parameter is missing', () => {
      gate.registerRule({ tool: 'delete', required: ['id'] });
      const result = gate.check('delete', {});
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.field).toBe('id');
    });

    it('should pass when all required parameters are present', () => {
      gate.registerRule({ tool: 'delete', required: ['id'] });
      const result = gate.check('delete', { id: 'abc123' });
      expect(result.pass).toBe(true);
    });

    it('should fail when param is explicitly undefined', () => {
      gate.registerRule({ tool: 'run', required: ['cmd'] });
      const result = gate.check('run', { cmd: undefined });
      expect(result.pass).toBe(false);
    });
  });

  describe('type check', () => {
    it('should fail when parameter type does not match', () => {
      gate.registerRule({
        tool: 'set_config',
        types: { timeout: 'number', url: 'string' },
      });
      const result = gate.check('set_config', { timeout: '100', url: 123 });
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors?.[0]?.expected).toBe('number');
      expect(result.errors?.[1]?.expected).toBe('string');
    });

    it('should pass when all types match', () => {
      gate.registerRule({
        tool: 'set_config',
        types: { timeout: 'number', url: 'string' },
      });
      const result = gate.check('set_config', { timeout: 100, url: 'https://api.example.com' });
      expect(result.pass).toBe(true);
    });

    it('should handle array type', () => {
      gate.registerRule({
        tool: 'batch',
        types: { ids: 'array' },
      });
      expect(gate.check('batch', { ids: [1, 2, 3] }).pass).toBe(true);
      expect(gate.check('batch', { ids: 'not-array' }).pass).toBe(false);
    });
  });

  describe('allowed values', () => {
    it('should reject values not in the allowed list', () => {
      gate.registerRule({
        tool: 'set_mode',
        allowedValues: { mode: ['read', 'write', 'execute'] },
      });
      expect(gate.check('set_mode', { mode: 'delete' }).pass).toBe(false);
      expect(gate.check('set_mode', { mode: 'read' }).pass).toBe(true);
    });

    it('should skip check for params not present', () => {
      gate.registerRule({
        tool: 'set_mode',
        allowedValues: { mode: ['read', 'write'] },
      });
      expect(gate.check('set_mode', {}).pass).toBe(true);
    });
  });

  describe('min/max constraints', () => {
    it('should enforce number minimum', () => {
      gate.registerRule({ tool: 'retry', min: { count: 1 } });
      expect(gate.check('retry', { count: 0 }).pass).toBe(false);
      expect(gate.check('retry', { count: 3 }).pass).toBe(true);
    });

    it('should enforce number maximum', () => {
      gate.registerRule({ tool: 'retry', max: { count: 5 } });
      expect(gate.check('retry', { count: 10 }).pass).toBe(false);
      expect(gate.check('retry', { count: 3 }).pass).toBe(true);
    });

    it('should enforce string length minimum', () => {
      gate.registerRule({ tool: 'search', min: { query: 3 } });
      expect(gate.check('search', { query: 'ab' }).pass).toBe(false);
      expect(gate.check('search', { query: 'abc' }).pass).toBe(true);
    });

    it('should enforce string length maximum', () => {
      gate.registerRule({ tool: 'search', max: { query: 10 } });
      expect(gate.check('search', { query: 'a'.repeat(20) }).pass).toBe(false);
    });

    it('should enforce array length min/max', () => {
      gate.registerRule({ tool: 'batch', min: { ids: 1 }, max: { ids: 100 } });
      expect(gate.check('batch', { ids: [] }).pass).toBe(false);
      expect(gate.check('batch', { ids: [1] }).pass).toBe(true);
      expect(gate.check('batch', { ids: Array.from({ length: 101 }) }).pass).toBe(false);
    });
  });

  describe('regex patterns', () => {
    it('should validate string against pattern', () => {
      gate.registerRule({ tool: 'set_email', patterns: { email: '^\\S+@\\S+\\.\\S+$' } });
      expect(gate.check('set_email', { email: 'test@example.com' }).pass).toBe(true);
      expect(gate.check('set_email', { email: 'not-an-email' }).pass).toBe(false);
    });

    it('should skip pattern check for non-string values', () => {
      gate.registerRule({ tool: 'set_email', patterns: { email: '^\\S+@\\S+\\.\\S+$' } });
      expect(gate.check('set_email', { email: 12345 }).pass).toBe(true);
    });
  });

  describe('custom validators', () => {
    it('should pass when custom validator returns null', () => {
      gate.registerRule({
        tool: 'port',
        custom: {
          port: (v: unknown) => (typeof v === 'number' && v > 0 && v < 65536 ? null : 'Invalid port number'),
        },
      });
      expect(gate.check('port', { port: 8080 }).pass).toBe(true);
    });

    it('should fail when custom validator returns error message', () => {
      gate.registerRule({
        tool: 'port',
        custom: {
          port: (v: unknown) => (typeof v === 'number' && v > 0 && v < 65536 ? null : 'Invalid port number'),
        },
      });
      const result = gate.check('port', { port: 99999 });
      expect(result.pass).toBe(false);
      expect(result.errors?.[0]?.message).toBe('Invalid port number');
    });
  });

  describe('combined checks', () => {
    it('should report all violations', () => {
      gate.registerRule({
        tool: 'api_call',
        required: ['url', 'method'],
        types: { method: 'string' },
        allowedValues: { method: ['GET', 'POST', 'PUT', 'DELETE'] },
        min: { url: 1 },
      });

      const result = gate.check('api_call', { method: 123 });
      expect(result.pass).toBe(false);
      expect(result.errors!.length).toBeGreaterThanOrEqual(2); // missing url + type mismatch
    });

    it('should pass valid input against full schema', () => {
      gate.registerRule({
        tool: 'api_call',
        required: ['url', 'method'],
        types: { method: 'string' },
        allowedValues: { method: ['GET', 'POST', 'PUT', 'DELETE'] },
        min: { url: 1 },
      });

      const result = gate.check('api_call', {
        url: 'https://api.example.com',
        method: 'GET',
      });
      expect(result.pass).toBe(true);
    });
  });
});
