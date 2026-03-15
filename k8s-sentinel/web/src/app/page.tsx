import ClusterOverview from './components/ClusterOverview';
import IssueTimeline from './components/IssueTimeline';
import FixProposals from './components/FixProposals';
import ChatPanel from './components/ChatPanel';
import PodOverview from './components/PodOverview';
import PredictionPanel from './components/PredictionPanel';
import RunbookEditor from './components/RunbookEditor';
import RunbookExecutions from './components/RunbookExecutions';

export default function Home() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-7xl mx-auto">
      <ClusterOverview />
      <PredictionPanel />
      <FixProposals />
      <PodOverview />
      <IssueTimeline />
      <RunbookExecutions />
      <RunbookEditor />
      <ChatPanel />
    </div>
  );
}
