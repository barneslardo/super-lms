import { useRef, useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AuthUser } from "@lms/shared";
import { api, type StudyChatMessage } from "../api";

export function StudyHelper({ user }: { user: AuthUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<StudyChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (nextMessages: StudyChatMessage[]) => api.studyChat(nextMessages),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, send.isPending]);

  if (user.role !== "student") return null;

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
        <div className="study-helper-panel">
          <div className="study-helper-header">
            <div>
              <strong>Study Helper</strong>
              <span>Scoped to your enrolled courses</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="study-helper-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <p className="study-helper-empty">
                Ask me anything about the classes you're enrolled in — concepts, homework help,
                or study strategies.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "study-helper-message study-helper-message-user"
                    : "study-helper-message study-helper-message-assistant"
                }
              >
                {m.content}
              </div>
            ))}
            {send.isPending && (
              <div className="study-helper-message study-helper-message-assistant study-helper-typing">
                Thinking…
              </div>
            )}
            {send.isError && (
              <div className="error">{(send.error as Error).message}</div>
            )}
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
