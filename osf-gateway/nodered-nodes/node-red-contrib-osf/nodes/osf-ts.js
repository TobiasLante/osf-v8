var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfTsNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.code = config.code || '';
    this.timeout = parseInt(config.timeout, 10) || 120;
    this.outputs = parseInt(config.outputs, 10) || 1;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      if (!bridge.ready) {
        node.error('Gateway bridge not initialized', msg);
        done(new Error('Gateway bridge not initialized'));
        return;
      }

      if (!node.code || !node.code.trim()) {
        done(new Error('osf-ts: no code configured'));
        return;
      }

      var svc = bridge.services;
      var input = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      var nodeId = node.id;
      var userId = (msg._osf && msg._osf.userId) || bridge.editorUserId || 'anonymous';

      node.status({ fill: 'blue', shape: 'dot', text: 'running...' });

      // Prepare code for the sandbox.
      // gateway-bridge.js executeSandbox handles the ES module→CJS transform
      // and wraps in (function(module, exports){...}).
      // We just need to inject the `input` variable and ensure the code has an export.
      var userCode = node.code;
      var hasExport = /export\s+default\s+/.test(userCode) || /module\.exports/.test(userCode);
      var bundledCode;
      if (hasExport) {
        bundledCode = 'var input = ' + JSON.stringify(input) + ';\n' + userCode;
      } else {
        // Plain code with no exports — wrap in module.exports
        bundledCode = 'var input = ' + JSON.stringify(input) + ';\n'
          + 'module.exports = { default: async function main(ctx) {\n'
          + userCode + '\n'
          + '}};\n';
      }

      svc.getLlmConfig(userId, 'premium').then(function(llmConfig) {
        var callbacks = {
          callMcpTool: function(name, args) { return svc.callMcpTool(name, args); },
          callLlm: function(prompt) {
            return svc.callLlm([{ role: 'user', content: prompt }], undefined, llmConfig)
              .then(function(r) { return r.content || ''; });
          },
          callLlmJson: function(prompt) {
            var jp = prompt + '\n\nIMPORTANT: Respond ONLY with valid JSON.';
            return svc.callLlm([{ role: 'user', content: jp }], undefined, llmConfig)
              .then(function(r) {
                var c = r.content || '';
                return c.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
              });
          },
          listTools: function() {
            return svc.getMcpTools().then(function(tools) {
              return JSON.stringify(tools.map(function(t) {
                return { name: t.function.name, description: t.function.description };
              }));
            });
          },
          storageGet: function(key) {
            return svc.pool.query(
              'SELECT value FROM code_agent_storage WHERE agent_id = $1 AND user_id = $2 AND key = $3',
              [nodeId, userId, key]
            ).then(function(r) { return r.rows.length > 0 ? JSON.stringify(r.rows[0].value) : null; });
          },
          storageSet: function(key, value) {
            return svc.pool.query(
              'INSERT INTO code_agent_storage (agent_id, user_id, key, value, updated_at) VALUES ($1, $2, $3, $4::jsonb, NOW()) ON CONFLICT (agent_id, user_id, key) DO UPDATE SET value = $4::jsonb, updated_at = NOW()',
              [nodeId, userId, key, value]
            );
          },
          storageDelete: function(key) {
            return svc.pool.query(
              'DELETE FROM code_agent_storage WHERE agent_id = $1 AND user_id = $2 AND key = $3',
              [nodeId, userId, key]
            );
          },
          log: function(message) { node.warn(message); },
        };

        return svc.executeSandbox(bundledCode, callbacks, node.timeout);
      }).then(function(res) {
        if (res.error) {
          throw new Error('osf-ts execution failed: ' + res.error);
        }

        // Multi-output support
        if (node.outputs > 1 && Array.isArray(res.result)) {
          var outputs = res.result.map(function(item) {
            var m = RED.util.cloneMessage(msg);
            m.payload = item;
            return m;
          });
          // Pad with nulls if fewer results than outputs
          while (outputs.length < node.outputs) outputs.push(null);
          node.status({ fill: 'green', shape: 'dot', text: 'done' });
          send(outputs);
          done();
        } else {
          msg.payload = res.result;
          node.status({ fill: 'green', shape: 'dot', text: 'done' });
          send(msg);
          done();
        }
      }).catch(function(err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done(err);
      });
    });
  }
  RED.nodes.registerType('osf-ts', OsfTsNode);
};
