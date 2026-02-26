var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfPromptNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.prompt = config.prompt;
    this.tier = config.tier || 'free';

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      if (!bridge.ready) { done(new Error('Gateway bridge not initialized')); return; }
      var svc = bridge.services;

      var promptText = node.prompt || '';
      // Substitute ${input} and ${context} with msg.payload
      var context = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload || '');
      promptText = promptText.replace(/\$\{input\}/g, context).replace(/\$\{context\}/g, context);

      if (!promptText) {
        done(new Error('osf-prompt: no prompt configured'));
        return;
      }

      node.status({ fill: 'blue', shape: 'dot', text: 'calling LLM...' });

      var userId = (msg._osf && msg._osf.userId) || bridge.editorUserId || 'anonymous';
      svc.getLlmConfig(userId, node.tier).then(function(llmConfig) {
        return svc.callLlm([{ role: 'user', content: promptText }], undefined, llmConfig);
      }).then(function(response) {
        msg.payload = response.content || '';
        msg._source = { type: 'osf-prompt', id: node.id, name: node.name };
        node.status({ fill: 'green', shape: 'dot', text: 'done' });
        send(msg);
        done();
      }).catch(function(err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done(err);
      });
    });
  }
  RED.nodes.registerType('osf-prompt', OsfPromptNode);
};
