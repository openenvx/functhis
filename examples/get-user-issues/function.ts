export default async function getUserIssues(ctx, input) {
  const user = await ctx.tools.readonly.get_user({ userId: input.userId });
  const issues = await ctx.tools.readonly.list_issues({
    owner: 'openenvx',
    repo: 'functhis',
  });
  return { issueCount: issues.issues.length, userId: user.userId };
}
