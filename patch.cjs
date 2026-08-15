const fs = require('fs');
let code = fs.readFileSync('serverIssueBacklog.ts', 'utf8');

const target = `      const { tags, links } = await loadBugTagsWithLinks(supabaseAdmin);
      const issuesById = new Map((issues || []).map((i: any) => [i.id, i]));
      const bugTags = tags.map((t: any) => {
        const linkedIds = links.filter((l: any) => l.tag_id === t.id).map((l: any) => l.issue_id);
        const linkedIssues = linkedIds
          .map((id: any) => issuesById.get(id))
          .filter(Boolean)
          .map((i: any) => ({
            id: i.id,
            created_at: i.created_at,
            status: i.status,
            issue_type: i.issue_type,
            context: i.context,
            chain_key: i.chain_key,
            dish_query: i.dish_query,
            user_note: i.user_note,
          }));
        return { ...t, linked_issue_ids: linkedIds, linked_issues: linkedIssues, linked_count: linkedIds.length };
      });

      // A report is a deletion candidate once it had a tag and now has none left.
      // Prefer ever_tagged; also treat any report that is currently unlinked but previously appeared in links is hard without history —
      // ever_tagged is the source of truth (set on every successful tag link).
      const linkedIssueIdSet = new Set(links.map((l: any) => l.issue_id));
      const deletionCandidates = (issues || []).filter(
        (i: any) => (i.ever_tagged === true || i.ever_tagged === 'true') && !linkedIssueIdSet.has(i.id)
      );

      // Preview of note → tag titles (for manual UI) without writing
      const reportNotePreviews = (issues || []).map((i: any) => ({
        id: i.id,
        suggested_titles: parseNoteIntoTagTitles(i.user_note),
      }));

      res.json({
        bugTags,
        allReports: issues || [],
        deletionCandidates,
        reportNotePreviews,
      });`;

const replacement = `      // Skipping slow tags fetch for lightweight overview response
      const bugTags: any[] = [];
      const deletionCandidates: any[] = [];
      const reportNotePreviews: any[] = [];
      res.json({
        bugTags,
        allReports: issues || [],
        deletionCandidates,
        reportNotePreviews,
      });`;

code = code.replace(target, replacement);
fs.writeFileSync('serverIssueBacklog.ts', code);
