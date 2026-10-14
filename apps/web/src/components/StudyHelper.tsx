import { useRef, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AuthUser } from "@lms/shared";
import { api, type StudyChatMessage } from "../api";

export function StudyHelper({ user }: { user: AuthUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [messages, setMessages] = useState<StudyChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  const modelsQuery = useQuery({
    queryKey: ["study-chat-models"],
    queryFn: api.studyChatModels,
    enabled: user.role === "student",
    staleTime: 5 * 60 * 1000,
  });
  const models = modelsQuery.data?.data.models ?? [];
  // Until the student picks one, follow the server's default (gemma4).
  const selectedModel = model || modelsQuery.data?.data.defaultModel || "";

  const send = useMutation({
    mutationFn: (nextMessages: StudyChatMessage[]) =>
      api.studyChat(nextMessages, selectedModel || undefined),
  });

  // Keep the latest question at the top of the panel so the answer reads
  // downward from it, instead of dropping the reader at the bottom of a long
  // explanation they then have to scroll back up through.
  useEffect(() => {
    const list = scrollRef.current;
    const anchor = lastUserRef.current;
    if (!list) return;
    if (!anchor) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
      return;
    }
    const spacer = spacerRef.current;
    if (spacer) {
      spacer.style.height = "0px";
      const tail = list.scrollHeight - anchor.offsetTop;
      spacer.style.height = `${Math.max(0, list.clientHeight - tail - 12)}px`;
    }
    list.scrollTo({ top: Math.max(0, anchor.offsetTop - 12), behavior: "smooth" });
  }, [messages, send.isPending, send.isError, isOpen, isWide]);

  if (user.role !== "student") return null;

  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");

  function handleSend() {
    const content = draft.trim();
    if (!content || send.isPending) return;
    const nextMessages: StudyChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setDraft("");
    send.mutate(nextMessages, {
      onSuccess: (res) => {
        setMessages((prev) => [...prev, { role: "assistant", content: res.data.reply }]);
      },
    });
  }

  function retryLast() {
    if (send.isPending || !messages.length) return;
    send.mutate(messages, {
      onSuccess: (res) => {
        setMessages((prev) => [...prev, { role: "assistant", content: res.data.reply }]);
      },
    });
  }

  return (
    <>
      <button
        type="button"
        className="study-helper-fab"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close Study Helper" : "Open Study Helper"}
      >
        {isOpen ? "✕" : "💬"}
      </button>

      {isOpen && (
        <div className={`study-helper-panel${isWide ? " wide" : ""}`}>
          <div className="study-helper-header">
            <div>
              <strong>Study Helper</strong>
              <span>Scoped to your enrolled courses</span>
            </div>
            <div className="study-helper-header-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsWide((v) => !v)}
                aria-label={isWide ? "Shrink panel" : "Expand panel"}
                title={isWide ? "Shrink" : "Expand"}
              >
                {isWide ? "⤡" : "⤢"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {models.length > 0 && (
            <div className="study-helper-model">
              <label htmlFor="study-helper-model">Model</label>
              <select
                id="study-helper-model"
                value={selectedModel}
                onChange={(e) => setModel(e.target.value)}
                disabled={send.isPending}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="study-helper-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <p className="study-helper-empty">
                Ask me anything about the classes you're enrolled in — concepts, homework help,
                or study strategies.
              </p>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  className="study-helper-message study-helper-message-user"
                  ref={i === lastUserIndex ? lastUserRef : undefined}
                >
                  {m.content}
                </div>
              ) : (
                <div key={i} className="study-helper-message study-helper-message-assistant study-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              )
            )}
            {send.isPending && (
              <div className="study-helper-message study-helper-message-assistant study-helper-typing">
                Thinking…
              </div>
            )}
            {send.isError && !send.isPending && (
              <div className="study-helper-error">
                <span>{(send.error as Error).message}</span>
                <button type="button" className="btn btn-ghost" onClick={retryLast}>
                  Try again
                </button>
              </div>
            )}
            <div ref={spacerRef} aria-hidden="true" className="study-helper-spacer" />
          </div>

          <div className="study-helper-composer">
            <textarea
              className="study-helper-input"
              placeholder="Ask a question about your coursework…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={send.isPending || !draft.trim()}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
