var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfOutputParserNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.schema = config.schema || '{}';
    this.maxRetries = parseInt(config.maxRetries, 10) || 2;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      var schema;
      try {
        schema = JSON.parse(node.schema);
      } catch (e) {
        done(new Error('osf-output-parser: invalid JSON schema'));
        return;
      }

      var content = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

      function validate(json) {
        var parsed = JSON.parse(json);
        if (schema.required && Array.isArray(schema.required)) {
          var missing = schema.required.filter(function(f) { return !(f in parsed); });
          if (missing.length > 0) throw new Error('Missing required fields: ' + missing.join(', '));
        }
        return parsed;
      }

      function attempt(text, retries) {
        try {
          var result = validate(text);
          msg.payload = result;
          node.status({ fill: 'green', shape: 'dot', text: 'done' });
          send(msg);
          done();
        } catch (err) {
          if (retries > 0 && bridge.ready) {
            node.status({ fill: 'yellow', shape: 'dot', text: 'retrying...' });
            var svc = bridge.services;
            var userId = (msg._osf && msg._osf.userId) || bridge.editorUserId || 'anonymous';
            svc.getLlmConfig(userId, 'premium').then(function(llmConfig) {
              var fixPrompt = 'Fix this JSON to match schema ' + node.schema + '. Error: ' + err.message + '\n\nOriginal:\n' + text + '\n\nRespond ONLY with valid JSON.';
              return svc.callLlm([{ role: 'user', content: fixPrompt }], undefined, llmConfig);
            }).then(function(resp) {
              var fixed = (resp.content || '').replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
              attempt(fixed, retries - 1);
            }).catch(function(e) { done(e); });
          } else {
            node.status({ fill: 'red', shape: 'ring', text: 'parse failed' });
            done(err);
          }
        }
      }

      attempt(content, node.maxRetries);
    });
  }
  RED.nodes.registerType('osf-output-parser', OsfOutputParserNode);
};
