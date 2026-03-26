// OSF i3X API — OpenAPI 3.0.3 Specification
// Full request/response schemas for Swagger UI compatibility

const auth = { security: [{ bearerAuth: [] }, { cookieAuth: [] }] };

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'OSF i3X API',
    version: '1.0.0',
    description: `REST API for the OpenShopFloor Knowledge Graph — inspired by CESMII i3X.

The graph is built automatically from SM Profile schemas on GitHub. 45 node types, 30+ edge types, vector embeddings. Data fused from PostgreSQL, OPC-UA, MQTT, and MCP sources.

**Key capabilities:**
- Type hierarchy with inheritance (Machine → CNC, IMM, Lathe, ...)
- Polymorphic edge resolution (targetIdProp → all matching types)
- Impact analysis via graph traversal
- Live machine data via MQTT sync`,
    contact: { name: 'OpenShopFloor', url: 'https://openshopfloor.zeroguess.ai' },
    license: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
  },
  servers: [
    { url: '/i3x', description: 'OSF Gateway (relative)' },
    { url: '/api/i3x', description: 'OSF Gateway /api prefix' },
  ],
  tags: [
    { name: 'Discovery', description: 'Type system, namespaces, relationship types' },
    { name: 'Objects', description: 'Instance data from the Knowledge Graph' },
    { name: 'Graph', description: 'Relationship traversal and impact analysis' },
    { name: 'Sync', description: 'Active data channels' },
  ],
  paths: {
    '/namespaces': {
      get: {
        tags: ['Discovery'],
        summary: 'ISA-95 hierarchy namespaces',
        description: 'Returns Sites and Areas from the Knowledge Graph as i3X namespaces.',
        ...auth,
        responses: {
          '200': {
            description: 'Array of namespaces',
            content: { 'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/Namespace' } },
              example: [
                { uri: 'urn:osf:site:Hauptwerk', displayName: 'Hauptwerk' },
                { uri: 'urn:osf:area:Spritzgusshalle', displayName: 'Spritzgusshalle' },
                { uri: 'urn:osf:area:Mechanische_Bearbeitung', displayName: 'Mechanische Bearbeitung' },
              ],
            } },
          },
        },
      },
    },
    '/objecttypes': {
      get: {
        tags: ['Discovery'],
        summary: 'SM Profile types',
        description: 'Returns all distinct node labels from the KG as object types, with parent type hierarchy from SM Profiles.',
        ...auth,
        responses: {
          '200': {
            description: 'Array of object types',
            content: { 'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/ObjectType' } },
              example: [
                { elementId: 'type:InjectionMoldingMachine', displayName: 'InjectionMoldingMachine', parentTypeId: 'type:Machine', namespaceUri: 'urn:osf:smprofile:InjectionMoldingMachine' },
                { elementId: 'type:CNC_Machine', displayName: 'CNC_Machine', parentTypeId: 'type:Machine', namespaceUri: 'urn:osf:smprofile:CNC_Machine' },
                { elementId: 'type:Article', displayName: 'Article', namespaceUri: 'urn:osf:smprofile:Article' },
                { elementId: 'type:CustomerOrder', displayName: 'CustomerOrder', parentTypeId: 'type:Order', namespaceUri: 'urn:osf:smprofile:CustomerOrder' },
                { elementId: 'type:Machine', displayName: 'Machine', namespaceUri: 'urn:osf:smprofile:Machine' },
              ],
            } },
          },
        },
      },
    },
    '/relationshiptypes': {
      get: {
        tags: ['Discovery'],
        summary: 'Edge types from KG',
        description: 'Returns all distinct edge labels with inverse names where known.',
        ...auth,
        responses: {
          '200': {
            description: 'Array of relationship types',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/RelationshipType' } } } },
          },
        },
      },
    },
    '/objects': {
      get: {
        tags: ['Objects'],
        summary: 'List objects',
        description: 'Returns object instances from the KG. Optionally filter by type.',
        ...auth,
        parameters: [
          { name: 'typeId', in: 'query', schema: { type: 'string' }, description: 'Filter by type (e.g. `type:CNC_Machine`)', example: 'type:InjectionMoldingMachine' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 500, maximum: 2000 }, description: 'Max results' },
        ],
        responses: {
          '200': {
            description: 'Array of objects',
            content: { 'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/Object' } },
              example: [
                { elementId: 'SGM-004', displayName: 'Spritzgussmaschine 4', typeId: 'type:InjectionMoldingMachine', isComposition: true, namespaceUri: 'urn:osf:injectionmoldingmachine', properties: { machine_id: 'SGM-004', name: 'Spritzgussmaschine 4', Machine_Status: 1, Good_Parts: 15670, Scrap_Parts: 234, OEE: 0.87, Temp_Melting: 234.5 } },
                { elementId: 'SGM-007', displayName: 'Spritzgussmaschine 7', typeId: 'type:InjectionMoldingMachine', properties: { machine_id: 'SGM-007', Machine_Status: 1, Good_Parts: 8920, OEE: 0.91 } },
              ],
            } },
          },
        },
      },
    },
    '/objects/{id}': {
      get: {
        tags: ['Objects'],
        summary: 'Get single object',
        description: 'Returns one object by elementId. Also resolves parentId via PART_OF edges.',
        ...auth,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Object elementId (machine_id, order_no, etc.)', example: 'SGM-004' },
        ],
        responses: {
          '200': { description: 'Object with parentId', content: { 'application/json': { schema: { $ref: '#/components/schemas/Object' } } } },
          '404': { description: 'Object not found' },
        },
      },
    },
    '/objects/{id}/children': {
      get: {
        tags: ['Graph'],
        summary: 'Composition children',
        description: 'Returns child objects connected via PART_OF edges (ISA-95 hierarchy drill-down).',
        ...auth,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'Hauptwerk' },
        ],
        responses: {
          '200': { description: 'Array of child objects', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Object' } } } } },
        },
      },
    },
    '/objects/{id}/kpis': {
      get: {
        tags: ['Objects'],
        summary: 'KPI values for an object',
        description: 'Returns all calculated KPIs (OEE, Quality Rate, Energy/Part, etc.) for the given object. KPIs are calculated by the KG Builder from live machine data.',
        ...auth,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Object elementId', example: 'SGM-004' },
        ],
        responses: {
          '200': {
            description: 'Array of KPI values',
            content: { 'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/KPI' } },
              example: [
                { kpiId: 'KPI-OEE', name: 'Overall Equipment Effectiveness', value: 87.3, unit: '%', category: 'efficiency', target: 85, warning: 75, critical: 60, status: 'good' },
                { kpiId: 'KPI-Quality-Rate', name: 'Quality Rate', value: 98.5, unit: '%', category: 'quality', target: 99, warning: 95, critical: 90, status: 'warning' },
                { kpiId: 'KPI-Energy-Per-Part', name: 'Energy per Good Part', value: 0.42, unit: 'kWh/part', category: 'energy', target: 0.5, warning: 1.0, critical: 2.0, status: 'good' },
                { kpiId: 'KPI-Scrap-Rate', name: 'Scrap Rate', value: 1.5, unit: '%', category: 'quality', target: 1, warning: 3, critical: 5, status: 'warning' },
              ],
            } },
          },
        },
      },
    },
    '/objects/related': {
      post: {
        tags: ['Graph'],
        summary: 'Related objects',
        description: 'Returns objects related to the given elementIds. Optionally filter by relationship type. This is the core graph traversal endpoint.',
        ...auth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['elementIds'],
                properties: {
                  elementIds: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Object IDs to find relations for', example: ['SGM-004', 'FA252630644'] },
                  relationshipTypeId: { type: 'string', description: 'Optional filter (e.g. `rel:WORKS_ON`)', example: 'rel:PRODUCES' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Array of related objects with relationship type',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      sourceElementId: { type: 'string' },
                      relationshipType: { type: 'string' },
                      object: { $ref: '#/components/schemas/Object' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/objects/value': {
      post: {
        tags: ['Objects'],
        summary: 'Current property values',
        description: 'Returns all current properties for the given elementIds. Includes live MQTT-synced values (Machine_Status, OEE, etc.).',
        ...auth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['elementIds'],
                properties: {
                  elementIds: { type: 'array', items: { type: 'string' }, maxItems: 100, example: ['SGM-004', 'SGM-007'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Array of element values',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      elementId: { type: 'string' },
                      values: { type: 'object', description: 'All node properties (SM attributes + live MQTT values)' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/subscriptions': {
      get: {
        tags: ['Sync'],
        summary: 'Active sync channels',
        description: 'Returns configured MQTT subscriptions and polling jobs that keep the KG updated in real-time.',
        ...auth,
        responses: {
          '200': {
            description: 'Array of active subscriptions',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['mqtt', 'polling'] },
                      broker: { type: 'string' },
                      topic: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Namespace: {
        type: 'object',
        required: ['uri', 'displayName'],
        properties: {
          uri: { type: 'string', example: 'urn:osf:site:Hauptwerk' },
          displayName: { type: 'string', example: 'Hauptwerk' },
        },
      },
      ObjectType: {
        type: 'object',
        required: ['elementId', 'displayName', 'namespaceUri'],
        properties: {
          elementId: { type: 'string', example: 'type:InjectionMoldingMachine' },
          displayName: { type: 'string', example: 'Injection Molding Machine' },
          parentTypeId: { type: 'string', example: 'type:Machine', description: 'Parent type from SM Profile inheritance' },
          namespaceUri: { type: 'string', example: 'urn:osf:smprofile:InjectionMoldingMachine' },
        },
      },
      RelationshipType: {
        type: 'object',
        required: ['elementId', 'displayName'],
        properties: {
          elementId: { type: 'string', example: 'rel:WORKS_ON' },
          displayName: { type: 'string', example: 'WORKS ON' },
          inverseDisplayName: { type: 'string', example: 'RUNS' },
        },
      },
      Object: {
        type: 'object',
        required: ['elementId', 'displayName'],
        description: 'A node from the Knowledge Graph. Properties include SM Profile attributes and live MQTT-synced values.',
        properties: {
          elementId: { type: 'string', example: 'SGM-004' },
          displayName: { type: 'string', example: 'Spritzgussmaschine 4' },
          typeId: { type: 'string', example: 'type:InjectionMoldingMachine' },
          parentId: { type: 'string', example: 'SGM-1300', description: 'Parent in ISA-95 hierarchy (via PART_OF edge)' },
          isComposition: { type: 'boolean', description: 'true for hierarchy nodes (Site, Area, Line, Machine)' },
          namespaceUri: { type: 'string', example: 'urn:osf:injectionmoldingmachine' },
          properties: {
            type: 'object',
            description: 'All node properties — SM attributes, BDE data, live MQTT values',
            example: {
              machine_id: 'SGM-004',
              name: 'Spritzgussmaschine 4',
              Machine_Status: 1,
              OEE: 0.87,
              Good_Parts: 1250,
              Temp_Melting: 234.5,
            },
          },
        },
      },
      KPI: {
        type: 'object',
        required: ['kpiId', 'name', 'value', 'unit'],
        description: 'A calculated KPI value for a machine or entity. Computed by the KG Builder from live data.',
        properties: {
          kpiId: { type: 'string', example: 'KPI-OEE' },
          name: { type: 'string', example: 'Overall Equipment Effectiveness' },
          value: { type: 'number', example: 87.3 },
          unit: { type: 'string', example: '%' },
          category: { type: 'string', enum: ['efficiency', 'quality', 'maintenance', 'energy', 'cost'] },
          target: { type: 'number', example: 85, description: 'Target value (green)' },
          warning: { type: 'number', example: 75, description: 'Warning threshold (yellow)' },
          critical: { type: 'number', example: 60, description: 'Critical threshold (red)' },
          lastCalculated: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['good', 'warning', 'critical'], description: 'Derived from value vs thresholds' },
        },
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'OSF Gateway access token (from /auth/login)',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'osf_access_token',
        description: 'OSF session cookie',
      },
    },
  },
  // No global security — /openapi.json and /docs are public.
  // All data endpoints have security set individually via requireAuth middleware.
};
