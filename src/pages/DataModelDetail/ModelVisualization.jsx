import React, { useMemo, useEffect } from 'react';
import ReactFlow, { 
  Background, 
  Controls,
  Handle,
  Position,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom node component for entities with field-specific handles
const EntityNode = ({ data }) => (
  <div className="min-w-[200px] bg-white border-2 border-blue-200 rounded-lg p-4 shadow-lg">
    <div className="font-bold text-lg text-blue-800 border-b-2 border-blue-100 pb-2 mb-2">
      {data.name}
    </div>
    {data.fields.map((field, index) => (
      <div key={index} className="text-sm py-1 flex flex-col relative">
        <div className="flex justify-between items-center">
          <span className="text-gray-700">
            {field.name}
            {field.isPrimary && ' 🔑'}
            {field.isUnique && ' 🎯'}
            {field.isIndex && ' 📇'}
          </span>
          <span className="text-gray-500 italic">
            {field.enumValues 
              ? `enum(${JSON.parse(field.enumValues).join(',')})`
              : field.fieldType}
          </span>
        </div>
        {field.defaultValue && (
          <span className="text-xs text-gray-400">
            default: {field.defaultValue}
          </span>
        )}
        <Handle 
          id={`${field.id}-target`}
          type="target" 
          position={Position.Left}
          className="!bg-blue-400 !w-2 !h-2"
          style={{ top: '50%', left: -8 }}
        />
        <Handle 
          id={`${field.id}-source`}
          type="source" 
          position={Position.Right}
          className="!bg-blue-400 !w-2 !h-2"
          style={{ top: '50%', right: -8 }}
        />
      </div>
    ))}
  </div>
);

const nodeTypes = {
  entity: EntityNode,
};

// Default edge styling
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: true,
  style: {
    stroke: '#93c5fd', // blue-300
    strokeWidth: 2,
  },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#93c5fd',
  },
  labelStyle: {
    fill: '#1e40af', // blue-800
    fontWeight: 600,
    fontSize: 12,
    background: 'white',
    padding: 4,
  },
  labelBgStyle: {
    fill: 'white',
    fillOpacity: 0.8,
  },
};

const ModelVisualization = ({ modelData }) => {
  const [mounted, setMounted] = React.useState(false);
  const { nodes, edges } = useMemo(() => {
    if (!modelData?.entities) return { nodes: [], edges: [] };

    // Create a map of entity IDs to their fields for easier lookup
    const entityFieldsMap = modelData.entities.reduce((acc, entity) => {
      acc[entity.id] = entity.fields;
      return acc;
    }, {});

    // Calculate connections and create nodes (same as before)
    const connectionCounts = modelData.entities.reduce((acc, entity) => {
      acc[entity.id] = {
        incoming: 0,
        outgoing: entity.fromRelations.length
      };
      return acc;
    }, {});

    // Count incoming connections
    modelData.entities.forEach(entity => {
      entity.fromRelations.forEach(relation => {
        if (connectionCounts[relation.toEntityId]) {
          connectionCounts[relation.toEntityId].incoming++;
        }
      });
    });

    // Sort entities based on their connections (most connected first)
    const sortedEntities = [...modelData.entities].sort((a, b) => {
      const aConnections = connectionCounts[a.id].incoming + connectionCounts[a.id].outgoing;
      const bConnections = connectionCounts[b.id].incoming + connectionCounts[b.id].outgoing;
      return bConnections - aConnections;
    });

    // Create nodes with a more spread out layout
    const nodes = sortedEntities.map((entity, index) => {
      // Use a circular layout for better distribution
      const totalEntities = sortedEntities.length;
      const radius = Math.min(totalEntities * 150, 800); // Adjust radius based on number of entities
      const angle = (2 * Math.PI * index) / totalEntities;
      
      return {
        id: entity.id.toString(),
        type: 'entity',
        position: { 
          x: radius * Math.cos(angle) + radius, // Center offset
          y: radius * Math.sin(angle) + radius  // Center offset
        },
        data: {
          name: entity.name,
          fields: entity.fields,
        },
      };
    });

    // Create edges with field-specific connections
    const edges = modelData.entities.flatMap(entity => 
      entity.fromRelations.map(relation => {
        // Find the related fields in both entities
        const sourceField = entity.fields.find(f => f.id === relation.fromFieldId);
        const targetEntity = modelData.entities.find(e => e.id === relation.toEntityId);
        const targetField = targetEntity?.fields.find(f => f.id === relation.toFieldId);

        return {
          id: relation.id.toString(),
          source: entity.id.toString(),
          target: relation.toEntityId.toString(),
          sourceHandle: `${sourceField?.id}-source`,
          targetHandle: `${targetField?.id}-target`,
          label: `${relation.name} (${relation.cardinality})`,
          type: 'smoothstep',
          animated: true,
          labelBgPadding: [8, 4],
          labelBgBorderRadius: 4,
          style: {
            strokeWidth: 2,
          },
        };
      })
    );

    return { nodes, edges };
  }, [modelData]);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className='bg-white rounded-lg shadow p-4'>
      <h2 className='text-lg font-semibold mb-4'>Data Model Visualization</h2>
      <div className='h-[800px] w-full border rounded'>
        {mounted && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={1.5}
            defaultViewport={{ zoom: 0.8 }}
          >
            {/* <Background color="#93c5fd" gap={16} size={1} /> */}
            <Controls className="!bg-white !shadow-lg" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
};

export default ModelVisualization;