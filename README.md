# dsh-plugin-text-quote-en

Codex/Cursor-style text annotation and side chat for DeepSeek Harness
conversations, with English labels. Select any text in the chat, add a quote
with your comment, and it becomes an annotation card in the composer. On send,
the annotation is injected into the message and rendered back as an expandable
"N notes" pill. Select text and choose **Ask in side chat** to explore it in a
forked conversation beside the main one.

This is a local English fork of
[`dsh-plugin-text-quote`](https://github.com/sunnystarye-ui/dsh-plugin-text-quote)
by sunnystarye-ui. It is a separate package (`dsh-plugin-text-quote-en`), so the
upstream plugin can be updated without touching this copy.

## Features

- **Side chat**: **Ask in side chat** in the selection menu opens a real fork of
  the current conversation in a right-sidebar tab and pre-fills its composer
  with the quoted text (nothing is sent until you send it). The side chat uses
  the native conversation UI and its own composer, so it has the full composer
  toolbar — including the **model selector**, where you can switch the side
  chat to a different model without touching the main conversation.
- **Selection notes**: selecting text in the conversation shows a menu →

  "Add to conversation" opens an editor that stores the selected text plus your
  comment.
- **Composer dock**: the note list sits to the left of the composer; expand it to
  view, edit, or delete notes.
- **Quote injection**: notes are injected as a block
  (`<!-- dsh-annotations:start -->` … `<!-- dsh-annotations:end -->`) when the
  message is sent, so the model can see them.
- **Sent-message pill**: the annotation block in a sent message collapses into a
  "N notes" pill; click it to expand the quoted text and comments.
- **Selection details**: "More details" opens a small panel with the full selected
  text, its character/word count, and a Copy button.
- **Keyboard**: in the editor, **Enter** saves, **Shift+Enter** adds a newline
  (Ctrl/Cmd+Enter also saves).
- Fully local: no telemetry, no external requests.

## Install

```bash
dsh plugin --profile web add /home/jmarceno/Projects/dsh-plugin-text-quote-en
```

Then add `dsh-plugin-text-quote-en` to `dsh.profile.bundles` in the profile's
`package.json` (the profile loader composes bundles from that list).

## Usage

1. Drag-select some text in the conversation.
2. Click **Add to conversation** in the floating menu (or **More details** to
   inspect the selection: full text, character/word count, Copy).
3. Type a comment in the editor (Enter saves, Shift+Enter adds a newline).
4. Send the message: the notes block is injected automatically and the sent
   message shows a **N notes** pill you can expand.

## Side chat

1. Select text in the conversation.
2. Click **Ask in side chat**. The first time, the plugin forks the conversation
   (full history by default) and opens the fork as a **Side chat** tab in the
   right sidebar; the quote is placed in the side chat's composer as a
   blockquote. Nothing is sent.
3. Type your question and send it as usual. The side chat streams, can call
   tools, ask for approvals, and run while the main conversation keeps going.
4. Use the tab header for:
   - **New** — start a fresh side chat for this conversation.
   - **Context: full / Context: lean** — what the *next* side chat inherits: the
     whole conversation, or only its last two completed turns. Full history
     keeps the parent's exact prefix, so a provider with automatic prefix
     caching can serve the inherited part at cache-read rates; lean keeps the
     first prompt small.
   - **To main** — insert the side chat's last completed answer into the main
     composer (nothing is sent).
   - The **model selector** in the side chat's composer switches the model for
     that side chat only.

One side chat is kept per conversation: selecting more text and clicking
**Ask in side chat** again reuses the same tab and appends the new quote to its
draft. The fork itself behaves like any other fork — it is a real session, it
appears in the session list, and it shares the workspace. Only the composing
side is separate; an answer is never injected into the main thread unless you
press **To main**.

## Compatibility

- DeepSeek Harness Web (`dsh web`), client plugin
  (`dsh.client.platform = web`).
- Requires the host to provide `@deepseek-ai/dsh-client-ui-slots`.
- The side chat additionally uses the shipped right sidebar
  (`@deepseek-ai/dsh-client-ui-sidebar-right`), the session controller
  (`@deepseek-ai/dsh-api-session-controller`) and the conversation composer
  service (`@deepseek-ai/dsh-client-ui-conversation`). With a host that lacks
  any of them, annotations keep working and **Ask in side chat** reports that
  the side chat is unavailable.

## Notes on the fork

The message block and dock use English labels (`<conversation-notes>`,
`[Note N]`, `Selected text:`, `Your comment:`). The sent-message parser still
understands annotation blocks written by the original Chinese plugin, so old
messages keep folding into a pill — they are just rendered with English labels.

## License

MIT. Original © sunnystarye-ui; English fork by jmarceno.
