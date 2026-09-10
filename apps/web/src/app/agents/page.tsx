'use client';

import { useEffect, useRef, useState } from 'react';
import { streamAgentChat, type AgentMessage } from '../../lib/agents';
import { useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc/trpc';

const AGENT_ID = 'takapp-agent';
const MESSAGES_PREFIX = 'takapp.agents.messages.';

function loadMessages(memoryId: string): AgentMessage[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MESSAGES_PREFIX + memoryId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentMessage[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(memoryId: string, messages: AgentMessage[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MESSAGES_PREFIX + memoryId, JSON.stringify(messages));
}

export default function AgentsPage() {
  const { t } = useI18n();
  const listQuery = trpc.agents.list.useQuery(undefined, { retry: false });
  const createMutation = trpc.agents.create.useMutation();
  const deleteMutation = trpc.agents.delete.useMutation();

  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeMemoryId, setActiveMemoryId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const introSeededRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    if (introSeededRef.current) return;
    if (new URLSearchParams(window.location.search).get('intro') !== '1') return;
    introSeededRef.current = true;
    void (async () => {
      try {
        const created = await createMutation.mutateAsync({ agentId: AGENT_ID });
        setActiveId(created.id);
        setActiveMemoryId(created.memoryId);
        const seeded: AgentMessage[] = [{ role: 'assistant', content: t('agents.intro') }];
        setMessages(seeded);
        saveMessages(created.memoryId, seeded);
        await listQuery.refetch();
      } catch {
        setError(t('agents.error'));
      }
    })();
  }, [createMutation, listQuery, t]);

  const conversations = listQuery.data?.conversations ?? [];

  function selectConversation(id: number): void {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    setActiveId(id);
    setActiveMemoryId(conversation.memoryId);
    setMessages(loadMessages(conversation.memoryId));
    setError(null);
  }

  async function newConversation(): Promise<void> {
    const created = await createMutation.mutateAsync({ agentId: AGENT_ID });
    setActiveId(created.id);
    setActiveMemoryId(created.memoryId);
    setMessages([]);
    setStreamingText('');
    setError(null);
    await listQuery.refetch();
  }

  async function removeConversation(id: number): Promise<void> {
    await deleteMutation.mutateAsync({ id });
    if (activeId === id) {
      setActiveId(null);
      setActiveMemoryId(null);
      setMessages([]);
    }
    await listQuery.refetch();
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);

    let memoryId = activeMemoryId;
    if (!memoryId) {
      try {
        const created = await createMutation.mutateAsync({ agentId: AGENT_ID });
        memoryId = created.memoryId;
        setActiveId(created.id);
        setActiveMemoryId(created.memoryId);
        await listQuery.refetch();
      } catch {
        setError(t('agents.error'));
        return;
      }
    }
    if (memoryId === null) return;

    const base = activeMemoryId === memoryId ? messages : [];
    const withUser: AgentMessage[] = [...base, { role: 'user', content: text }];
    setMessages(withUser);
    saveMessages(memoryId, withUser);

    setStreaming(true);
    setStreamingText('');
    let assistantContent = '';

    try {
      await streamAgentChat(AGENT_ID, memoryId, text, {
        onToken: (delta) => {
          assistantContent += delta;
          setStreamingText(assistantContent);
        },
        onError: (message) => {
          setError(message);
        },
      });
    } catch {
      setError(t('agents.error'));
    }

    if (assistantContent) {
      const final: AgentMessage[] = [...withUser, { role: 'assistant', content: assistantContent }];
      setMessages(final);
      saveMessages(memoryId, final);
    }
    setStreaming(false);
    setStreamingText('');
    await listQuery.refetch();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-coffee-100">{t('agents.title')}</h1>
        <button
          onClick={newConversation}
          disabled={createMutation.isPending}
          className="rounded-md bg-coffee-600 px-3 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
        >
          {t('agents.newConversation')}
        </button>
      </div>

      {conversations.length > 0 && (
        <aside className="flex gap-2 overflow-x-auto">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                activeId === conversation.id
                  ? 'border-coffee-500 bg-coffee-700 text-coffee-50'
                  : 'border-coffee-700 text-coffee-200'
              }`}
            >
              <button onClick={() => selectConversation(conversation.id)} className="max-w-40 truncate">
                {conversation.title ?? t('agents.untitled')}
              </button>
              <button
                onClick={() => removeConversation(conversation.id)}
                aria-label={t('nav.logOut')}
                className="text-coffee-400"
              >
                ×
              </button>
            </div>
          ))}
        </aside>
      )}

      <section className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && !streaming && (
          <p className="text-coffee-400">{t('agents.noConversations')}</p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2 text-sm ${
              message.role === 'user'
                ? 'self-end bg-coffee-600 text-coffee-50'
                : 'self-start bg-coffee-900 text-coffee-100'
            }`}
          >
            {message.content}
          </div>
        ))}
        {streaming && (
          <div className="max-w-[85%] self-start whitespace-pre-wrap rounded-xl bg-coffee-900 px-4 py-2 text-sm text-coffee-100">
            {streamingText || t('agents.thinking')}
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div ref={bottomRef} />
      </section>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('agents.inputPlaceholder')}
          disabled={streaming}
          className="flex-1 rounded-md border border-coffee-700 bg-coffee-900 px-3 py-2 text-coffee-100 placeholder:text-coffee-500"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
        >
          {t('agents.send')}
        </button>
      </form>
    </main>
  );
}
