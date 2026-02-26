module.exports = function(RED) {
  function OsfSubFlowNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.flowId = config.flowId || '';
    this.maxDepth = parseInt(config.maxDepth, 10) || 3;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      // Sub-flow execution requires the full engine — only works via Run button
      node.status({ fill: 'yellow', shape: 'ring', text: 'pass-through' });
      node.warn('osf-sub-flow: sub-flow execution is only supported via the Run button, not in editor debug mode');
      msg.payload = msg.payload;
      send(msg);
      done();
    });
  }
  RED.nodes.registerType('osf-sub-flow', OsfSubFlowNode);
};
