import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {Plus, Star} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {toast} from '@/hooks/use-toast'
import {commandAdminStory, listAdminStories, type AdminStoryListItem, type StoryCommandAction, type StoryStatus} from '@/lib/storiesAdminApi'
import {TEMPLATE_INFO} from '@/lib/storyDraft'

const PAGE = 20
const FILTERS: Array<[StoryStatus | '', string]> = [['', 'All'], ['draft', 'Drafts'], ['published', 'Published'], ['archived', 'Archived']]

/** Editorial stories for Discover. Everyone on staff can see them; only admins can change them. */
export function StoriesSection({role}: {role: 'reviewer' | 'admin'}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StoryStatus | ''>('')
  const [offset, setOffset] = useState(0)
  const stories = useQuery({queryKey: ['marketplace-admin', 'stories', status, offset], queryFn: () => listAdminStories({status, offset, limit: PAGE})})
  const command = useMutation({
    mutationFn: ({story, action}: {story: AdminStoryListItem; action: StoryCommandAction}) => commandAdminStory(story.id, action, story.version),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({queryKey: ['marketplace-admin', 'stories']}), queryClient.invalidateQueries({queryKey: ['stories']})])
    },
    onError: (error) => toast({title: 'Action failed', description: error.message, variant: 'destructive'}),
  })
  const admin = role === 'admin'
  const total = stories.data?.total ?? 0

  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Stories</h1><p className="mt-1 text-sm text-zinc-400">Editorial stories on Discover. One published story can be featured at a time.</p></div>
      {admin && <Button asChild className="gap-2 bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300"><Link to="/app/marketplace-admin/stories/new"><Plus className="h-4 w-4" />New story</Link></Button>}
    </div>
    <div role="tablist" aria-label="Story status" className="mt-5 inline-flex rounded-md border border-white/10 p-0.5 text-sm">
      {FILTERS.map(([value, label]) => <button key={label} type="button" role="tab" aria-selected={status === value} onClick={() => { setStatus(value); setOffset(0) }}
        className={`rounded px-3 py-1.5 ${status === value ? 'bg-emerald-400 font-semibold text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'}`}>{label}</button>)}
    </div>
    {stories.isError ? <p role="alert" className="mt-4 text-sm text-red-300">{stories.error.message}</p>
      : !stories.data ? <p className="mt-4 text-sm text-zinc-500">Loading…</p>
        : stories.data.items.length === 0 ? <p className="mt-4 border-y border-dashed border-white/10 py-12 text-center text-sm text-zinc-500">No stories here yet.</p>
          : <div className="mt-4 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr className="text-xs uppercase text-zinc-500"><th className="px-3 py-3">Title</th><th className="px-3 py-3">Template</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Published</th><th className="px-3 py-3">Views</th><th className="px-3 py-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-white/10">{stories.data.items.map((story) => <tr key={story.id}>
              <td className="px-3 py-3"><p className="flex items-center gap-2 font-medium text-zinc-100">{story.featured && <Star aria-label="Featured" className="h-4 w-4 fill-emerald-400 text-emerald-400" />}{story.title}</p><p className="text-xs text-zinc-500">/stories/{story.slug}</p></td>
              <td className="px-3 py-3 text-zinc-300">{TEMPLATE_INFO[story.template].name}</td>
              <td className="px-3 py-3"><span className={story.status === 'published' ? 'text-emerald-300' : story.status === 'archived' ? 'text-zinc-500' : 'text-amber-200'}>{story.status}</span>{story.featured && <span className="ml-2 text-xs text-emerald-300">featured</span>}</td>
              <td className="px-3 py-3 text-zinc-400">{story.published_at ? new Date(story.published_at).toLocaleDateString() : '—'}</td>
              <td className="px-3 py-3 tabular-nums text-zinc-300">{Number(story.view_count ?? 0).toLocaleString('en-US')}</td>
              <td className="px-3 py-3"><div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline"><Link to={`/app/marketplace-admin/stories/${story.id}?step=${story.status === 'archived' ? 'preview' : 'content'}`}>{admin ? 'Edit' : 'View'}</Link></Button>
                {story.status === 'published' ? <Button asChild size="sm" variant="ghost"><Link to={`/stories/${story.slug}`} target="_blank">View live</Link></Button>
                  : <Button asChild size="sm" variant="ghost"><Link to={`/app/marketplace-admin/stories/${story.id}?step=preview`}>Preview</Link></Button>}
                {admin && story.status === 'draft' && <Button size="sm" variant="ghost" disabled={command.isPending} onClick={() => command.mutate({story, action: 'publish'})}>Publish</Button>}
                {admin && story.status === 'published' && <Button size="sm" variant="ghost" disabled={command.isPending} onClick={() => command.mutate({story, action: story.featured ? 'unfeature' : 'feature'})}>{story.featured ? 'Unfeature' : 'Feature'}</Button>}
                {admin && story.status === 'published' && <Button size="sm" variant="ghost" disabled={command.isPending} onClick={() => command.mutate({story, action: 'unpublish'})}>Unpublish</Button>}
                {admin && story.status !== 'archived' && <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-red-300" disabled={command.isPending} onClick={() => { if (window.confirm(`Archive "${story.title}"?`)) command.mutate({story, action: 'archive'}) }}>Archive</Button>}
              </div></td>
            </tr>)}</tbody>
          </table></div>}
    {total > PAGE && <div className="mt-4 flex items-center justify-between text-sm text-zinc-400">
      <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button><Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button></div>
    </div>}
  </section>
}
