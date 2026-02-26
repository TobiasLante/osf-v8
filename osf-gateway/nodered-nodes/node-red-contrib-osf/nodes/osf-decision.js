var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfDecisionNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.prompt = config.prompt;
    this.field = config.field || '';
    this.outputLabels = config.outputLabels || ['Yes', 'No'];
    this.outputs = (config.outputLabels || ['Yes', 'No']).length;

    /** Traverse dot-path like "result.ok" */
    function getNestedField(obj, path) {
      var parts = path.split('.');
      var cur = obj;
      for (var i = 0; i < parts.length; i++) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[parts[i]];
      }
      return cur;
    }

    /** Match value to closest label index */
    function matchValueToLabel(value, labels) {
      var str = String(value).toLowerCase().trim();
      if (['true', 'yes', '1', 'ok', 'ja'].indexOf(str) >= 0) return 0;
      if (['false', 'no', '0', 'nein'].indexOf(str) >= 0) return labels.length > 1 ? 1 : 0;
      for (var i = 0; i < labels.length; i++) {
        if (labels[i].toLowerCase().indexOf(str) >= 0 || str.indexOf(labels[i].toLowerCase()) >= 0) return i;
      }
      return 0;
    }

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      var labels = node.outputLabels;
      var outputs = new Array(labels.length).fill(null);
      var data = msg.payload;

      // Fast path: field-based routing without LLM
      if (node.field) {
        try {
          var parsed = typeof data === 'string' ? JSON.parse(data) : (data || {});
          var value = getNestedField(parsed, node.field);
          if (value !== undefined) {
            var port = matchValueToLabel(value, labels);
            node.status({ fill: 'green', shape: 'dot', text: labels[port] });
            outputs[port] = msg;
            send(outputs);
            done();
            return;
          }
        } catch (e) { /* fall through to LLM */ }
      }

      // LLM path
      if (!bridge.ready) { done(new Error('Gateway bridge not initialized')); return; }
      var svc = bridge.services;

      var promptTemplate = node.prompt || 'Classify the following input. Respond with ONLY the category name.\n\nCategories: {{labels}}\n\nInput:\n{{input}}';
      var inputText = typeof data === 'string' ? data : JSON.stringify(data || '');
      if (inputText.length > 4000) inputText = inputText.slice(0, 4000) + '\n...[truncated]';

      var prompt = promptTemplate
        .replace(/\{\{input\}\}/g, inputText)
        .replace(/\{\{labels\}\}/g, labels.join(', '));

      node.status({ fill: 'blue', shape: 'dot', text: 'deciding...' });

      var userId = (msg._osf && msg._osf.userId) || bridge.editorUserId || 'anonymous';
      svc.getLlmConfig(userId, 'free').then(function(llmConfig) {
        return svc.callLlm([{ role: 'user', content: prompt }], undefined, llmConfig);
      }).then(function(response) {
        var answer = (response.content || '').trim().toLowerCase();
        var matchedPort = 0;
        for (var i = 0; i < labels.length; i++) {
          var label = labels[i].toLowerCase();
          var keyword = label.split(/[\s\-:]/)[0].trim();
          if (answer.indexOf(label) >= 0 || (keyword && answer.indexOf(keyword) >= 0)) {
            matchedPort = i;
            break;
          }
        }
        msg.payload = response.content || labels[matchedPort];
        node.status({ fill: 'green', shape: 'dot', text: labels[matchedPort] });
        outputs[matchedPort] = msg;
        send(outputs);
        done();
      }).catch(function(err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done(err);
      });
    });
  }
  RED.nodes.registerType('osf-decision', OsfDecisionNode);
};
