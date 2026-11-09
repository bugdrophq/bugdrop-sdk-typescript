import { TITLE_PREFIX } from './config.mjs';
export const feedbackFor = (target) => ({
  schemaVersion: 1,
  title: `${TITLE_PREFIX} ${target.marker}`,
  description: `SDK synthetic delivery check.\n\n${target.marker}`,
  category: 'bug',
});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function verifyIssue(issues, target, evidence) {
  if (
    !evidence.postValidated ||
    !evidence.receiptId ||
    !uuid.test(evidence.receiptId) ||
    !evidence.submissionId ||
    !uuid.test(evidence.submissionId)
  )
    return 'inconclusive';
  if (issues.length === 0) return 'issue_absent';
  if (issues.length !== 1) return 'issue_duplicate';
  const issue = issues[0];
  const feedback = feedbackFor(target);
  const expectedUrl = `https://github.com/${target.repository}/issues/${issue.number}`;
  if (
    !Number.isSafeInteger(issue.number) ||
    issue.number < 1 ||
    issue.pull_request ||
    issue.title !== feedback.title ||
    !issue.body?.includes(feedback.description) ||
    issue.user?.login?.toLowerCase() !== target.author.toLowerCase() ||
    JSON.stringify(
      issue.labels.map((label) => (typeof label === 'string' ? label : label.name)).sort()
    ) !== JSON.stringify([...target.labels].sort()) ||
    issue.html_url?.toLowerCase() !== expectedUrl.toLowerCase() ||
    issue.state !== 'open'
  )
    return 'issue_contract_invalid';
  return 'issue_verified';
}
