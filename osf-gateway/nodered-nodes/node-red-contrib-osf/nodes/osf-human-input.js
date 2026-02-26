module.exports = function(RED) {
  function OsfHumanInputNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.prompt = config.prompt;
    this.options = config.options;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      // In NR editor mode: show status and wait for manual injection
      // The flow pauses here — user must click the inject button or use the NR dashboard
      node.status({ fill: 'yellow', shape: 'ring', text: 'Waiting for input...' });

      var promptText = node.prompt || 'Please provide input';
      node.warn('osf-human-input: "' + promptText + '" — In editor mode, inject a msg to continue. Options: ' + JSON.stringify(node.options || []));

      // Store pending state so a second inject can continue the flow
      node._pendingMsg = msg;
      node._pendingSend = send;
      node._pendingDone = done;
    });

    // Allow a second input to "answer" the human-input node
    var origOn = node.on.bind(node);
    node.on('input', function(msg, send, done) {
      if (node._pendingMsg) {
        // This is the "answer" — use the new msg.payload as the response
        var pendingMsg = node._pendingMsg;
        var pendingSend = node._pendingSend;
        var pendingDone = node._pendingDone;
        node._pendingMsg = null;
        node._pendingSend = null;
        node._pendingDone = null;

        pendingMsg.payload = msg.payload;
        pendingMsg._source = { type: 'osf-human-input', id: node.id, name: node.name };
        node.status({ fill: 'green', shape: 'dot', text: 'answered' });
        pendingSend(pendingMsg);
        pendingDone();
        if (done) done();
      }
    });
  }
  RED.nodes.registerType('osf-human-input', OsfHumanInputNode);
};
