import DomainSelector from './components/DomainSelector';
import DataSources from './components/DataSources';
import PipelineRunner from './components/PipelineRunner';
import GraphExplorer from './components/GraphExplorer';

export default function Home() {
  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DomainSelector />
        <DataSources className="lg:col-span-2" />
      </div>
      <PipelineRunner />
      <GraphExplorer />
    </div>
  );
}
