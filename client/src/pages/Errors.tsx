import { Link } from 'react-router-dom';
import { Lock, SearchX } from 'lucide-react';
import { Empty } from '../ui';

export function NotFound() {
  return (
    <div className="page">
      <Empty icon={<SearchX size={32} />} title="Page not found">
        <Link to="/">Back to dashboard</Link>
      </Empty>
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="page">
      <Empty icon={<Lock size={32} />} title="You don't have access to this page">
        Ask an administrator if you need this permission.
      </Empty>
    </div>
  );
}
