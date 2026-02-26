var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfLlmNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.llmUrl = config.llmUrl || '';
    this.llmModel = config.llmModel || '';
    this.temperature = parseFloat(config.temperature) || 0.3;
    this.jsonMode = config.jsonMode || false;

    // For dual-input: collect context + prompt
    var pendingContext = null;
    var pendingPrompt = null;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      if (!bridge.ready) {
        node.error('Gateway bridge not initialized', msg);
        done(new Error('Gateway bridge not initialized'));
        return;
      }

      var svc = bridge.services;
      var sourceType = (msg._source && msg._source.type) || '';

      // Identify input by source type
      if (sourceType === 'osf-context') {
        pendingContext = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      } else if (sourceType === 'osf-prompt-tpl') {
        pendingPrompt = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      } else {
        // Single input — treat as user prompt
        pendingPrompt = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      }

      // If we have both or only prompt, execute
      // Small delay to allow both inputs to arrive
      clearTimeout(node._execTimer);
      node._execTimer = setTimeout(function() {
        var memory = pendingContext || '';
        var userPrompt = pendingPrompt || '';
        pendingContext = null;
        pendingPrompt = null;

        if (!userPrompt && !memory) {
          done(new Error('osf-llm: no input'));
          return;
        }

        node.status({ fill: 'blue', shape: 'dot', text: 'calling LLM...' });

        // Get LLM config — use node config or default
        var userId = (msg._osf && msg._osf.userId) || bridge.editorUserId || 'anonymous';
        svc.getLlmConfig(userId, 'premium').then(function(defaultConfig) {
          var llmConfig = {
            baseUrl: node.llmUrl || defaultConfig.baseUrl,
            model: node.llmModel || defaultConfig.model,
            apiKey: defaultConfig.apiKey,
          };

          var messages = [];
          if (memory) messages.push({ role: 'system', content: memory });
          var prompt = userPrompt;
          if (node.jsonMode) {
            prompt += '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences.';
          }
          messages.push({ role: 'user', content: prompt });

          return svc.callLlm(messages, undefined, llmConfig);
        }).then(function(response) {
          var content = response.content || '';
          if (node.jsonMode) {
            content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          }
          msg.payload = content;
          node.status({ fill: 'green', shape: 'dot', text: 'done' });
          send(msg);
          done();
        }).catch(function(err) {
          node.status({ fill: 'red', shape: 'ring', text: 'error' });
          done(err);
        });
      }, 50);
    });

    node.on('close', function() {
      clearTimeout(node._execTimer);
    });
  }
  RED.nodes.registerType('osf-llm', OsfLlmNode);
};
