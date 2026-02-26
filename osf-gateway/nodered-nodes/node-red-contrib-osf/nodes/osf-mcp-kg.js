var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfMcpKgNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.toolName = config.toolName;
    this.arguments = config.arguments;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      if (!bridge.ready) {
        done(new Error('Gateway bridge not initialized'));
        return;
      }

      var svc = bridge.services;
      var toolName = node.toolName;
      var argsStr = node.arguments || '{}';

      if (msg.payload && typeof msg.payload === 'object') {
        argsStr = argsStr.replace(/\$\{([^}]+)\}/g, function(_m, key) {
          var val = msg.payload[key.trim()];
          return val != null ? String(val) : '';
        });
      }

      var args;
      try {
        args = JSON.parse(argsStr);
      } catch (e) {
        args = {};
      }

      node.status({ fill: 'blue', shape: 'dot', text: toolName + '...' });

      svc.callMcpTool(toolName, args).then(function(result) {
        msg.payload = result;
        msg._source = { type: 'osf-mcp-kg', id: node.id, name: node.name || toolName };
        node.status({ fill: 'green', shape: 'dot', text: 'done' });
        send(msg);
        done();
      }).catch(function(err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done(err);
      });
    });
  }
  RED.nodes.registerType('osf-mcp-kg', OsfMcpKgNode);
};
