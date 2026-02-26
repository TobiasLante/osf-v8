var bridge = require('../lib/gateway-bridge');

module.exports = function(RED) {
  function OsfAgentNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    this.agentId = config.agentId;
    this.passContext = config.passContext;
    this.maxIterations = config.maxIterations || 6;

    node.on('input', function(msg, send, done) {
      send = send || function() { node.send.apply(node, arguments); };
      done = done || function(err) { if (err) node.error(err, msg); };

      if (!bridge.ready) { done(new Error('Gateway bridge not initialized')); return; }
      var svc = bridge.services;

      var agentId = node.agentId;
      if (!agentId) { done(new Error('osf-agent: agentId not configured')); return; }

      node.status({ fill: 'blue', shape: 'dot', text: 'agent running...' });

      // Fetch agent definition from DB
      svc.pool.query('SELECT * FROM agents WHERE id = $1', [agentId]).then(function(res) {
        if (!res.rows[0]) throw new Error('osf-agent: agent "' + agentId + '" not found');
        var agent = res.rows[0];

        var context = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload || '');
        var passContext = node.passContext !== false;

        var userMessage = passContext && context
          ? '--- Context from previous step ---\n' + context + '\n--- End context ---\n\nPlease run your full analysis now, taking the above context into account.'
          : 'Please run your full analysis now.';

        var userId = (msg._osf && msg._osf.userId) || bridge.editorUserId || 'anonymous';
        return svc.getLlmConfig(userId, 'premium').then(function(llmConfig) {
          // Build tools list from agent config
          var tools = [];
          try {
            var toolNames = JSON.parse(agent.tools || '[]');
            tools = toolNames;
          } catch (e) { tools = []; }

          // Simple agent loop: system prompt + user message → LLM → tool calls → repeat
          var messages = [];
          if (agent.system_prompt) messages.push({ role: 'system', content: agent.system_prompt });
          messages.push({ role: 'user', content: userMessage });

          function iterate(iter) {
            if (iter >= node.maxIterations) {
              return Promise.resolve(messages[messages.length - 1].content || '');
            }
            return svc.callLlm(messages, tools.length > 0 ? tools : undefined, llmConfig).then(function(response) {
              if (response.tool_calls && response.tool_calls.length > 0) {
                messages.push({ role: 'assistant', content: response.content || '', tool_calls: response.tool_calls });
                // Execute tool calls sequentially
                var chain = Promise.resolve();
                response.tool_calls.forEach(function(tc) {
                  chain = chain.then(function() {
                    return svc.callMcpTool(tc.function.name, JSON.parse(tc.function.arguments || '{}')).then(function(result) {
                      messages.push({ role: 'tool', tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result) });
                    });
                  });
                });
                return chain.then(function() { return iterate(iter + 1); });
              }
              return response.content || '';
            });
          }

          return iterate(0);
        });
      }).then(function(result) {
        msg.payload = result;
        msg._source = { type: 'osf-agent', id: node.id, name: node.name };
        node.status({ fill: 'green', shape: 'dot', text: 'done' });
        send(msg);
        done();
      }).catch(function(err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        done(err);
      });
    });
  }
  RED.nodes.registerType('osf-agent', OsfAgentNode);
};
