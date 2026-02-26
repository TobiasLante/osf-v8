module.exports = function(RED) {
  function OsfContextNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.keyOverrides = config.keyOverrides || {};
    this.collectCount = parseInt(config.collectCount, 10) || 0;

    // Track incoming messages for multi-input collection
    var pending = {};
    var pendingCount = 0;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      // Determine source node info
      var sourceId = (msg._source && msg._source.id) || msg._msgid || ('input_' + pendingCount);
      var sourceType = (msg._source && msg._source.type) || 'unknown';
      var sourceLabel = (msg._source && msg._source.name) || sourceType;

      // Sanitize label to key
      var key = node.keyOverrides[sourceId] || sourceLabel.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || ('input_' + pendingCount);

      pending[key] = msg.payload;
      pendingCount++;

      // Collect mode: wait for collectCount messages
      if (node.collectCount > 0) {
        node.status({ fill: 'blue', shape: 'ring', text: pendingCount + '/' + node.collectCount });
        done(); // Complete this message's processing (payload stored)

        if (pendingCount >= node.collectCount) {
          var out = Object.assign({}, pending);
          pending = {};
          pendingCount = 0;
          msg.payload = out;
          node.status({ fill: 'green', shape: 'dot', text: 'done (' + Object.keys(out).length + ')' });
          send(msg);
        }
        return;
      }

      // No collect mode: pass through immediately (single-input)
      msg.payload = pending;
      msg._source = { type: 'osf-context', id: node.id, name: node.name };
      pending = {};
      pendingCount = 0;
      node.status({});
      send(msg);
      done();
    });

    node.on('close', function() {
      pending = {};
      pendingCount = 0;
    });
  }
  RED.nodes.registerType('osf-context', OsfContextNode);
};
