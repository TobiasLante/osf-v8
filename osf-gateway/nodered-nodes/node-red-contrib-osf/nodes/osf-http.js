var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfHttpNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.url = config.url || '';
    this.method = (config.method || 'GET').toUpperCase();
    this.returnJson = config.returnJson !== false;
    this.authType = config.authType || 'none';
    this.authValue = config.authValue || '';
    this.timeout = (parseInt(config.timeout, 10) || 30) * 1000;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      var data = msg.payload;
      var url = node.url;

      // Template replacement in URL
      url = url.replace(/(?:\$\{([^}]+)\}|\{\{([^}]+)\}\})/g, function(_m, p1, p2) {
        var path = (p1 || p2).trim().split('.');
        var val = data;
        for (var i = 0; i < path.length; i++) {
          if (val === undefined || val === null) return '';
          val = typeof val === 'object' ? val[path[i]] : undefined;
        }
        return val != null ? encodeURIComponent(String(val)) : '';
      });

      if (!url) {
        done(new Error('osf-http: no URL configured'));
        return;
      }

      node.status({ fill: 'blue', shape: 'dot', text: node.method + ' ...' });

      var headers = {};
      if (node.authType === 'bearer' && node.authValue) headers['Authorization'] = 'Bearer ' + node.authValue;
      if (node.authType === 'api-key' && node.authValue) headers['X-API-Key'] = node.authValue;

      var opts = { method: node.method, headers: headers };
      if (['POST', 'PUT', 'PATCH'].indexOf(node.method) >= 0 && data !== undefined) {
        opts.body = typeof data === 'string' ? data : JSON.stringify(data);
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }

      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, node.timeout);
      opts.signal = controller.signal;

      fetch(url, opts).then(function(resp) {
        clearTimeout(timer);
        if (!resp.ok) {
          return resp.text().then(function(t) { throw new Error('HTTP ' + resp.status + ': ' + t.slice(0, 500)); });
        }
        return node.returnJson ? resp.json() : resp.text();
      }).then(function(result) {
        msg.payload = result;
        node.status({ fill: 'green', shape: 'dot', text: 'done' });
        send(msg);
        done();
      }).catch(function(err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done(err);
      });
    });
  }
  RED.nodes.registerType('osf-http', OsfHttpNode);
};
