module.exports = function(RED) {
  function OsfPromptTplNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.template = config.template || '';

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      var input = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      var result = node.template
        .replace(/\$\{context\}/g, input)
        .replace(/\$\{input\}/g, input);

      node.status({ fill: 'green', shape: 'dot', text: 'done' });
      msg.payload = result;
      send(msg);
      done();
    });
  }
  RED.nodes.registerType('osf-prompt-tpl', OsfPromptTplNode);
};
