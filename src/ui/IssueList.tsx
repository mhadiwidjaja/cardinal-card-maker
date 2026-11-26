import type { Issue } from '../model/types';

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <section className="issues">
      <h3>
        {errors > 0 && `${errors} error${errors > 1 ? 's' : ''}`}
        {errors > 0 && issues.length > errors && ', '}
        {issues.length > errors && `${issues.length - errors} warning${issues.length - errors > 1 ? 's' : ''}`}
      </h3>
      <ul>
        {issues.map((issue, i) => (
          <li key={i} className={issue.level}>
            <code>{issue.file || '(workspace)'}</code> {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
