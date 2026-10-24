window.__ModuleLoader__.load({
  id: 'dsh-plugin-text-quote-en',
  factory: function(require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    // `sessions`, `conversation` and the right sidebar are resolved lazily with
    // ctx.get(...) so a host without them still loads the annotation features.
    var inject = ['slots']
    var notesBySession = new Map()
    var bindings = new Map()
    var listeners = new Map()
    var markers = new Map()
    var activeSessionId = null
    var selectionMenu = null
    var editor = null
    var detailsPanel = null
    var pendingSelection = null
    var submitArmed = false
    var START = '<!-- dsh-annotations:start -->'
    var END = '<!-- dsh-annotations:end -->'
    var BLOCK_OPEN = '<conversation-notes>'
    var BLOCK_CLOSE = '</conversation-notes>'
    // Zero-width joiner: keeps the composer "dirty" while notes are attached so
    // the host enables its send button even with an empty draft.
    var DRAFT_TOKEN = '\u2063'

    function listOf(sessionId) {
      var list = notesBySession.get(sessionId)
      if (!list) { list = []; notesBySession.set(sessionId, list) }
      return list
    }

    function emit(sessionId) {
      var set = listeners.get(sessionId)
      if (set) set.forEach(function(fn) { fn() })
      renderMarkers()
    }

    function subscribe(sessionId, fn) {
      var set = listeners.get(sessionId)
      if (!set) { set = new Set(); listeners.set(sessionId, set) }
      set.add(fn)
      return function() { set.delete(fn) }
    }

    function plural(count) {
      return String(count) + (count === 1 ? ' note' : ' notes')
    }

    function annotationBlock(list) {
      if (!list.length) return ''
      var rows = [START, BLOCK_OPEN]
      list.forEach(function(note, index) {
        rows.push('[Note ' + (index + 1) + ']')
        rows.push('Selected text:')
        rows.push(note.text)
        rows.push('Your comment:')
        rows.push(note.comment)
      })
      rows.push(BLOCK_CLOSE, END)
      return rows.join('\n')
    }

    function draftOf(sessionId) {
      var binding = bindings.get(sessionId)
      return binding && binding.input && typeof binding.input.draft === 'string' ? binding.input.draft : ''
    }

    function syncDraftToken(sessionId) {
      var binding = bindings.get(sessionId)
      if (!binding || !binding.inputActions) return
      var draft = draftOf(sessionId)
      var clean = draft.split(DRAFT_TOKEN).join('')
      var hasNotes = listOf(sessionId).length > 0
      binding.inputActions.setDraft(hasNotes ? DRAFT_TOKEN + clean : clean)
    }

    function injectBeforeSubmit() {
      if (submitArmed || !activeSessionId) return false
      var sessionId = activeSessionId
      var binding = bindings.get(sessionId)
      var list = listOf(sessionId)
      if (!binding || !binding.inputActions || !list.length) return false
      var draft = draftOf(sessionId).split(DRAFT_TOKEN).join('')
      if (draft.indexOf(START) >= 0) return false
      var block = annotationBlock(list)
      submitArmed = true
      binding.inputActions.setDraft(draft.trim() ? draft + '\n\n' + block : block)
      Promise.resolve().then(function() {
        binding.inputActions.submit()
        notesBySession.set(sessionId, [])
        emit(sessionId)
        submitArmed = false
      })
      return true
    }

    function closeSelectionMenu() {
      if (selectionMenu) selectionMenu.style.display = 'none'
      pendingSelection = null
    }

    function closeEditor() {
      if (editor) editor.remove()
      editor = null
    }

    function onDetailsOutside(event) {
      if (!detailsPanel) return
      if (detailsPanel.contains(event.target)) return
      if (event.target && event.target.closest && event.target.closest('.dsh-selection-menu')) return
      closeDetails()
    }

    function onDetailsKeydown(event) {
      if (event.key === 'Escape') closeDetails()
    }

    function closeDetails() {
      if (detailsPanel) detailsPanel.remove()
      detailsPanel = null
      document.removeEventListener('click', onDetailsOutside, true)
      document.removeEventListener('keydown', onDetailsKeydown, true)
    }

    function markerMap(sessionId) {
      var map = markers.get(sessionId)
      if (!map) { map = new Map(); markers.set(sessionId, map) }
      return map
    }

    function renderMarkers() {
      markers.forEach(function(map, sessionId) {
        var live = new Set(listOf(sessionId).map(function(note) { return note.id }))
        map.forEach(function(marker, id) { if (!live.has(id)) { marker.remove(); map.delete(id) } })
      })
      if (!activeSessionId) return
      var map = markerMap(activeSessionId)
      listOf(activeSessionId).forEach(function(note, index) {
        var marker = map.get(note.id)
        if (!marker) {
          marker = document.createElement('button')
          marker.type = 'button'
          marker.className = 'dsh-note-marker'
          marker.addEventListener('click', function() { openEditor(note.id) })
          document.body.appendChild(marker)
          map.set(note.id, marker)
        }
        marker.textContent = String(index + 1)
        var rect
        try { rect = note.range && note.range.getBoundingClientRect() } catch (error) { rect = null }
        if (!rect || (!rect.width && !rect.height)) { marker.style.display = 'none'; return }
        marker.style.display = 'grid'
        marker.style.left = Math.min(window.innerWidth - 32, rect.right + 5) + 'px'
        marker.style.top = Math.max(8, rect.top - 12) + 'px'
      })
    }

    function removeNote(sessionId, id) {
      notesBySession.set(sessionId, listOf(sessionId).filter(function(note) { return note.id !== id }))
      closeEditor()
      emit(sessionId)
      syncDraftToken(sessionId)
    }

    function saveEditor(id, text, range, comment) {
      comment = String(comment || '').trim()
      if (!comment || !activeSessionId) return false
      var list = listOf(activeSessionId)
      if (id) {
        var current = list.find(function(note) { return note.id === id })
        if (current) current.comment = comment
      } else {
        list.push({ id:Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text:text, comment:comment, range:range })
      }
      emit(activeSessionId)
      syncDraftToken(activeSessionId)
      closeEditor()
      return true
    }

    function openEditor(id, selectedText, selectedRange, selectedRect) {
      closeSelectionMenu()
      closeEditor()
      closeDetails()
      if (!activeSessionId) return
      var note = id ? listOf(activeSessionId).find(function(item) { return item.id === id }) : null
      var rect = selectedRect
      if (!rect && note && note.range) {
        try { rect = note.range.getBoundingClientRect() } catch (error) {}
      }
      if (!rect) rect = { right:window.innerWidth / 2, top:window.innerHeight / 2 }
      editor = document.createElement('div')
      editor.className = 'dsh-note-editor'
      editor.innerHTML = '<textarea aria-label="Add note" placeholder="Add an optional comment..."></textarea><div class="dsh-note-editor-actions"><button class="dsh-note-trash" type="button" title="Delete note" aria-label="Delete note">&#128465;</button><span></span><button class="dsh-note-cancel" type="button">Cancel</button><button class="dsh-note-save" type="button">Save</button></div>'
      editor.style.left = Math.max(12, Math.min(window.innerWidth - 344, rect.right + 16)) + 'px'
      editor.style.top = Math.max(12, Math.min(window.innerHeight - 210, rect.top - 8)) + 'px'
      var textarea = editor.querySelector('textarea')
      textarea.value = note ? note.comment : ''
      editor.querySelector('.dsh-note-trash').addEventListener('click', function() { if (note) removeNote(activeSessionId, note.id); else closeEditor() })
      editor.querySelector('.dsh-note-cancel').addEventListener('click', closeEditor)
      editor.querySelector('.dsh-note-save').addEventListener('click', function() { saveEditor(note && note.id, note ? note.text : selectedText, note ? note.range : selectedRange, textarea.value) })
      textarea.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' || event.isComposing) return
        if (event.shiftKey) return
        event.preventDefault()
        saveEditor(note && note.id, note ? note.text : selectedText, note ? note.range : selectedRange, textarea.value)
      })
      document.body.appendChild(editor)
      focusEditorTextarea(textarea)
    }

    // The click that opens the editor lands on a menu button, and the host may
    // reclaim focus while the surrounding conversation re-renders. Focus now and
    // repeat briefly while nothing else has legitimately taken focus.
    function focusEditorTextarea(textarea) {
      function put() {
        if (!textarea.isConnected) return
        try { textarea.focus({ preventScroll: true }) } catch (error) { textarea.focus() }
        try { textarea.setSelectionRange(textarea.value.length, textarea.value.length) } catch (error) {}
      }
      function retry() {
        if (!textarea.isConnected) return
        var active = document.activeElement
        var free = !active || active === document.body || active === textarea
          || (active.closest && active.closest('.dsh-selection-menu, .dsh-note-editor'))
        if (free) put()
      }
      put()
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(retry)
      setTimeout(retry, 40)
      setTimeout(retry, 160)
      setTimeout(retry, 360)
    }

    function openDetails(selection) {
      closeDetails()
      closeSelectionMenu()
      if (!selection) return
      var text = selection.text || ''
      var rect = selection.rect
      var words = text.trim() ? text.trim().split(/\s+/).length : 0
      detailsPanel = document.createElement('div')
      detailsPanel.className = 'dsh-selection-details'
      detailsPanel.innerHTML = '<div class="dsh-details-head"><span class="dsh-details-title">Selection details</span><button class="dsh-details-close" type="button" title="Close" aria-label="Close">\u00d7</button></div><div class="dsh-details-text"></div><div class="dsh-details-meta"></div><div class="dsh-details-actions"><button class="dsh-details-copy" type="button">Copy</button></div>'
      detailsPanel.querySelector('.dsh-details-text').textContent = text
      detailsPanel.querySelector('.dsh-details-meta').textContent = text.length + ' characters \u00b7 ' + words + ' words'
      detailsPanel.querySelector('.dsh-details-close').addEventListener('click', closeDetails)
      var copy = detailsPanel.querySelector('.dsh-details-copy')
      copy.addEventListener('click', function() {
        if (!navigator.clipboard || !navigator.clipboard.writeText) { copy.textContent = 'Copy unavailable'; return }
        navigator.clipboard.writeText(text).then(function() {
          copy.textContent = 'Copied'
          setTimeout(function() { copy.textContent = 'Copy' }, 1400)
        }, function() { copy.textContent = 'Copy failed' })
      })
      document.body.appendChild(detailsPanel)
      var width = detailsPanel.offsetWidth || 460
      var height = detailsPanel.offsetHeight || 200
      var left = rect ? rect.right - width : (window.innerWidth - width) / 2
      var top = rect ? rect.bottom + 8 : (window.innerHeight - height) / 2
      if (rect && top + height > window.innerHeight - 12) top = rect.top - height - 8
      detailsPanel.style.left = Math.max(12, Math.min(window.innerWidth - width - 12, left)) + 'px'
      detailsPanel.style.top = Math.max(12, Math.min(window.innerHeight - height - 12, top)) + 'px'
      // Ignore the click that opened the panel; close on the next outside click.
      setTimeout(function() {
        if (!detailsPanel) return
        document.addEventListener('click', onDetailsOutside, true)
        document.addEventListener('keydown', onDetailsKeydown, true)
      }, 0)
    }

    function NotesDock(props) {
      var sessionId = props.sessionId
      var state = React.useState(0)
      var setVersion = state[1]
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      bindings.set(sessionId, { input:props.input, inputActions:props.inputActions })
      React.useEffect(function() {
        activeSessionId = sessionId
        renderMarkers()
        return subscribe(sessionId, function() { setVersion(function(value) { return value + 1 }) })
      }, [sessionId])
      var list = listOf(sessionId)
      if (!list.length) return null
      return React.createElement('div', { className:'dsh-note-dock' },
        open ? React.createElement('div', { className:'dsh-note-card' }, list.map(function(note, index) {
          return React.createElement('div', { className:'dsh-note-row', key:note.id },
            React.createElement('div', { className:'dsh-note-number' }, String(index + 1) + '.'),
            React.createElement('div', { className:'dsh-note-body' },
              React.createElement('div', { className:'dsh-note-label' }, 'Selected text:'),
              React.createElement('div', { className:'dsh-note-selected' }, note.text),
              React.createElement('div', { className:'dsh-note-label' }, 'Your comment:'),
              React.createElement('div', { className:'dsh-note-comment' }, note.comment)
            ),
            React.createElement('div', { className:'dsh-note-row-actions' },
              React.createElement('button', { type:'button', title:'Edit note', 'aria-label':'Edit note', onClick:function() { openEditor(note.id) } }, '\u270e'),
              React.createElement('button', { type:'button', title:'Delete note', 'aria-label':'Delete note', onClick:function() { removeNote(sessionId, note.id) } }, '\u00d7')
            )
          )
        })) : null,
        React.createElement('button', { type:'button', className:'dsh-note-summary', 'aria-expanded':open, onClick:function() { setOpen(!open) } },
          React.createElement('span', { 'aria-hidden':true }, '\u25a2'),
          React.createElement('span', null, plural(list.length))
        )
      )
    }

    // --- Side chat ---------------------------------------------------------
    // A Codex/Cursor-style side chat built only from public DSH client APIs:
    // fork the conversation (full prefix by default, last turns in lean mode),
    // open the fork as a real right-sidebar tab that renders the native
    // conversation, and prefill its composer with the quoted selection.
    var SIDE_TAB_ID = 'dsh-plugin-text-quote-en/side'
    var SIDE_TAB_KIND = 'textquote-side'
    var SIDE_CONVERSATION_SLOT = 'textquote.sidechat.conversation'
    var SIDE_STORE = 'dsh-plugin-text-quote-en:side:v1:'
    var SIDE_SETTINGS = 'dsh-plugin-text-quote-en:side-settings:v1'
    var SIDE_LEAN_TURNS = 2

    function readJSON(key, fallback) {
      try {
        var raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : fallback
      } catch (error) { return fallback }
    }

    function writeJSON(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)) } catch (error) {}
    }

    function sideSettings() {
      var stored = readJSON(SIDE_SETTINGS, null)
      return { mode: stored && stored.mode === 'lean' ? 'lean' : 'full' }
    }

    function setSideMode(mode) { writeJSON(SIDE_SETTINGS, { mode: mode === 'lean' ? 'lean' : 'full' }) }
    function sideRecord(parentId) { return readJSON(SIDE_STORE + parentId, null) }
    function rememberSide(parentId, record) { writeJSON(SIDE_STORE + parentId, record) }
    function forgetSide(parentId) { try { localStorage.removeItem(SIDE_STORE + parentId) } catch (error) {} }

    function errText(error) {
      if (!error) return 'Unknown error'
      return error.message ? String(error.message) : String(error)
    }

    function sleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms) }) }

    // The quote as a Markdown blockquote, so the side chat can tell the
    // selected text apart from whatever the user types next.
    function sideQuote(text) {
      return String(text || '').split(/\r?\n/).map(function(line) { return '> ' + line }).join('\n')
    }

    function sideTopic(text) {
      var flat = String(text || '').replace(/\s+/g, ' ').trim()
      if (!flat) return ''
      return flat.length > 42 ? flat.slice(0, 42) + '\u2026' : flat
    }

    function sessionKnown(sessions, id) {
      try {
        var byId = sessions.list.getSnapshot().byId
        return !!(byId && byId[id])
      } catch (error) { return false }
    }

    // Boundary seq of the turn N before the last: an inclusive cut there keeps
    // the newest N completed turns while dropping everything older.
    async function leanBoundarySeq(ctx, parentId) {
      var sessions = ctx.get('sessions')
      if (!sessions) return undefined
      var reference
      try {
        reference = sessions.retain(parentId, { source: 'sidebarChat' })
        await reference.ready
        var entries = reference.binding.eventSource.getSnapshot().entries || []
        var ends = []
        entries.forEach(function(entry) {
          if (entry && entry.type === 'event' && entry.event && entry.event.type === 'turn/end') ends.push(entry.event.seq)
        })
        if (ends.length <= SIDE_LEAN_TURNS) return undefined
        return ends[ends.length - SIDE_LEAN_TURNS - 1]
      } catch (error) {
        return undefined
      } finally {
        if (reference) reference.release()
      }
    }

    // A fork starts on the Host default model, not on the one the parent is
    // using. Copy the parent's current selection into the child so the side
    // chat answers with the same model (and the same cache domain) until the
    // user changes it with the composer's model selector.
    async function inheritModel(ctx, parentId, childId) {
      var models = ctx.get('modelDirectories')
      if (!models || typeof models.directoryFor !== 'function') return
      try {
        var source = models.directoryFor(parentId)
        try { await source.load() } catch (error) {}
        var state = source.store.getSnapshot()
        var selection = state.current || state.pending
        if (!selection) return
        var target
        for (var attempt = 0; attempt < 12; attempt += 1) {
          try { target = models.directoryFor(childId); break } catch (error) { await sleep(200) }
        }
        if (!target) return
        try { await target.load() } catch (error) {}
        try {
          await target.select({
            provider: selection.provider,
            model: selection.model,
            ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {})
          })
        } catch (error) {
          console.warn('[text-quote-en] could not inherit the parent model:', error)
        }
      } catch (error) {
        console.warn('[text-quote-en] model inheritance unavailable:', error)
      }
    }

    async function ensureSideChat(ctx, parentId) {
      var sessions = ctx.get('sessions')
      if (!sessions) throw new Error('The sessions service is unavailable.')
      var record = sideRecord(parentId)
      if (record && record.childId && sessionKnown(sessions, record.childId)) return record.childId
      var options = { sessionId: parentId, increaseTitle: false }
      if (sideSettings().mode === 'lean') {
        var atSeq = await leanBoundarySeq(ctx, parentId)
        if (atSeq !== undefined) options.atSeq = atSeq
      }
      var childId = await sessions.fork(options)
      rememberSide(parentId, {
        childId: childId,
        createdAt: Date.now(),
        title: record && record.title ? record.title : ''
      })
      return childId
    }

    function openSideTab(ctx, parentId, childId) {
      var sidebar = ctx.get('sidebarRight')
      if (!sidebar || typeof sidebar.openTab !== 'function') throw new Error('The right sidebar is unavailable.')
      sidebar.openTab(SIDE_TAB_KIND, { params: { childId: childId, parentId: parentId } })
    }

    async function prefillSideChat(ctx, childId, text) {
      var conversation = ctx.get('conversation')
      if (!conversation || !conversation.input || typeof conversation.input.shell !== 'function') {
        throw new Error('The composer service is unavailable.')
      }
      for (var attempt = 0; attempt < 40; attempt += 1) {
        try {
          var shell = conversation.input.shell(childId)
          if (shell && shell.state && typeof shell.setDraft === 'function') {
            var current = shell.state.getSnapshot().draft || ''
            var kept = current.replace(/\s+$/, '')
            shell.setDraft(kept ? kept + '\n\n' + text : text)
            try { shell.focus() } catch (error) {}
            return
          }
        } catch (error) {}
        await sleep(150)
      }
      throw new Error('The side chat composer did not open in time.')
    }

    async function askInSideChat(ctx, text) {
      var parentId = activeSessionId || lastBindingSession()
      if (!parentId) { flashNotice('Open a conversation first.'); return }
      var quote = sideQuote(text)
      try {
        var childId = await ensureSideChat(ctx, parentId)
        var record = sideRecord(parentId)
        if (record && !record.title) {
          record.title = sideTopic(text)
          rememberSide(parentId, record)
        }
        openSideTab(ctx, parentId, childId)
        var modelReady = inheritModel(ctx, parentId, childId)
        await prefillSideChat(ctx, childId, quote)
        await Promise.race([modelReady, sleep(1500)])
      } catch (error) {
        console.warn('[text-quote-en] side chat failed:', error)
        flashNotice('Could not open the side chat: ' + errText(error))
      }
    }

    function lastBindingSession() {
      var last = null
      bindings.forEach(function(value, key) { last = key })
      return last
    }

    function messageText(message) {
      if (!message) return ''
      if (typeof message.text === 'string' && message.text.trim()) return message.text.trim()
      var blocks = message.content
      if (!Array.isArray(blocks)) return ''
      return blocks.map(function(block) {
        return block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''
      }).join('').trim()
    }

    async function lastAnswerText(ctx, childId) {
      var sessions = ctx.get('sessions')
      if (!sessions) return ''
      var reference
      try {
        reference = sessions.retain(childId, { source: 'sidebarChat' })
        await reference.ready
        var entries = reference.binding.eventSource.getSnapshot().entries || []
        for (var index = entries.length - 1; index >= 0; index -= 1) {
          var entry = entries[index]
          if (!entry || entry.type !== 'event' || !entry.event) continue
          if (entry.event.type !== 'assistant/message') continue
          var text = messageText(entry.event.data && entry.event.data.message)
          if (text) return text
        }
        return ''
      } finally {
        if (reference) reference.release()
      }
    }

    async function bringAnswerToMain(ctx, parentId, childId) {
      var text = await lastAnswerText(ctx, childId)
      if (!text) return false
      var conversation = ctx.get('conversation')
      if (!conversation || !conversation.input || typeof conversation.input.shell !== 'function') return false
      var shell = conversation.input.shell(parentId)
      var current = shell.state.getSnapshot().draft || ''
      var kept = current.replace(/\s+$/, '')
      shell.setDraft(kept ? kept + '\n\n' + text : text)
      try { shell.focus() } catch (error) {}
      return true
    }

    function flashNotice(text) {
      var toast = document.createElement('div')
      toast.className = 'dsh-sidechat-toast'
      toast.textContent = text
      document.body.appendChild(toast)
      setTimeout(function() { toast.remove() }, 4200)
    }

    function SideChatBody(props) {
      var ctx = props.ctx
      var info = props.useTabInfo ? props.useTabInfo() : null
      var tab = info && info.tab ? info.tab : null
      var params = tab && tab.navigation && tab.navigation.params ? tab.navigation.params : {}
      // The tab lives in the parent conversation's sidebar, so the injected
      // session id identifies the parent even when a restored layout loses the
      // navigation params. The child id then falls back to the stored mapping.
      var parentId = props.sessionId || (typeof params.parentId === 'string' ? params.parentId : '')
      var record = parentId ? sideRecord(parentId) : null
      var childId = typeof params.childId === 'string' && params.childId
        ? params.childId
        : (record && record.childId ? record.childId : '')
      var referenceState = React.useState(null)
      var reference = referenceState[0]
      var setReference = referenceState[1]
      var modeState = React.useState(sideSettings().mode)
      var mode = modeState[0]
      var setMode = modeState[1]
      var noticeState = React.useState('')
      var notice = noticeState[0]
      var setNotice = noticeState[1]

      React.useEffect(function() {
        if (!ctx || !childId) return undefined
        var sessions = ctx.get('sessions')
        if (!sessions) { setNotice('The sessions service is unavailable.'); return undefined }
        var held
        try {
          held = sessions.retain(childId, { source: 'sidebarChat', signal: tab && tab.signal })
        } catch (error) {
          setNotice('Could not open the side chat: ' + errText(error))
          return undefined
        }
        setReference(held)
        setNotice('')
        if (held.ready && held.ready.catch) {
          held.ready.catch(function(error) { setNotice('Could not load the side chat: ' + errText(error)) })
        }
        return function() {
          setReference(null)
          held.release()
        }
      }, [childId])

      function startNew() {
        if (!parentId) return
        setNotice('Starting a new side chat\u2026')
        forgetSide(parentId)
        ensureSideChat(ctx, parentId).then(function(child) {
          openSideTab(ctx, parentId, child)
          inheritModel(ctx, parentId, child)
          setNotice('')
        }, function(error) {
          setNotice('Could not start a side chat: ' + errText(error))
        })
      }

      function toggleMode() {
        var next = mode === 'full' ? 'lean' : 'full'
        setSideMode(next)
        setMode(next)
        setNotice('New side chats will inherit ' + (next === 'lean'
          ? 'the last ' + SIDE_LEAN_TURNS + ' turns.'
          : 'the full conversation.'))
      }

      function toMain() {
        if (!parentId || !childId) return
        bringAnswerToMain(ctx, parentId, childId).then(function(ok) {
          setNotice(ok ? 'Inserted the last answer into the main composer.' : 'There is no completed answer to bring back yet.')
        }, function(error) {
          setNotice('Could not bring the answer back: ' + errText(error))
        })
      }

      function action(label, title, onClick) {
        return React.createElement('button', { type:'button', className:'dsh-sidechat-action', title:title, onClick:onClick }, label)
      }

      return React.createElement('div', { className:'dsh-sidechat' },
        React.createElement('div', { className:'dsh-sidechat-head' },
          React.createElement('span', { className:'dsh-sidechat-name', title: record && record.title ? record.title : 'Side chat' }, 'Side chat'),
          React.createElement('div', { className:'dsh-sidechat-actions' },
            action('New', 'Start a new side chat for this conversation', startNew),
            action(mode === 'lean' ? 'Context: lean' : 'Context: full', 'What new side chats inherit: the full conversation or only the last ' + SIDE_LEAN_TURNS + ' turns', toggleMode),
            action('To main', 'Insert the last answer into the main composer', toMain)
          )
        ),
        notice ? React.createElement('div', { className:'dsh-sidechat-notice' }, notice) : null,
        React.createElement('div', { className:'dsh-sidechat-conversation' },
          reference && props.SessionProvider && typeof props.renderSlot === 'function'
            ? React.createElement(props.SessionProvider, { session: reference }, props.renderSlot(SIDE_CONVERSATION_SLOT, {}))
            : React.createElement('div', { className:'dsh-sidechat-empty' }, childId ? 'Preparing the side chat\u2026' : 'No side chat is linked to this tab.')
        )
      )
    }

    function SideChatView(props) {
      return props.renderSlot('conversation.session', { view: 'chat' })
    }

    // Renders the native conversation for the session scope the tab's
    // SessionProvider established. `renderFactorySlot` and `renderSlot` are
    // supplied to slot bodies by the slot runtime; the factory is the same one
    // the main conversation uses, so streaming, tools, approvals and the
    // composer (including its model selector) are the native ones.
    function SideChatConversation(props) {
      return props.renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: 'active', hero: false },
        { slots: { views: SideChatView } }
      )
    }

    class SideChatBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error: error && error.message ? error.message : String(error) }
      }
      componentDidCatch(error) {
        console.warn('[text-quote-en] side chat rendering failed:', error)
      }
      render() {
        if (this.state.error !== null) {
          return React.createElement('div', { className:'dsh-sidechat-empty' }, 'The side chat could not be rendered: ' + this.state.error)
        }
        return this.props.children
      }
    }

    function SideChatPane(props) {
      return React.createElement(SideChatBoundary, null, React.createElement(SideChatBody, props))
    }

    function SideChatTitle(props) {
      var info = props.useTabInfo ? props.useTabInfo() : null
      var tab = info && info.tab ? info.tab : null
      var params = tab && tab.navigation && tab.navigation.params ? tab.navigation.params : {}
      var parentId = props.sessionId || (typeof params.parentId === 'string' ? params.parentId : '')
      var record = parentId ? sideRecord(parentId) : null
      return React.createElement('span', null, record && record.title ? 'Side \u00b7 ' + record.title : 'Side chat')
    }

    function registerSideChat(ctx) {
      ctx.inject(['sidebarRightTabs'], function(scope) {
        scope.effect(function() {
          return scope.sidebarRightTabs.register({
            id: SIDE_TAB_ID,
            kind: SIDE_TAB_KIND,
            title: function() { return 'Side chat' }
          })
        }, 'dsh-plugin-text-quote-en: side chat type')
        scope.effect(function() {
          return scope.slots.inject(SIDE_CONVERSATION_SLOT, function() {
            return scope.slots.register({ name: SIDE_CONVERSATION_SLOT }, SideChatConversation)
          })
        }, 'dsh-plugin-text-quote-en: side chat conversation')
        scope.effect(function() {
          return scope.slots.inject('sidebar.right.pane.tab', function() {
            return scope.slots.register({
              name: 'sidebar.right.pane.tab',
              key: SIDE_TAB_ID,
              children: { [SIDE_CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
              inject: function(sessionId) { return { ctx: ctx, sessionId: sessionId } }
            }, SideChatPane)
          })
        }, 'dsh-plugin-text-quote-en: side chat body')
        scope.effect(function() {
          return scope.slots.inject('sidebar.right.pane.tab.title', function() {
            return scope.slots.register({
              name: 'sidebar.right.pane.tab.title',
              key: SIDE_TAB_ID,
              inject: function(sessionId) { return { ctx: ctx, sessionId: sessionId } }
            }, SideChatTitle)
          })
        }, 'dsh-plugin-text-quote-en: side chat title')
      })
    }

    function apply(ctx) {
      ctx.effect(function() {
        // Static manifest plugins get no `styles` closure argument (dynamic
        // inline plugins only), so inject a native <style> element instead.
        var styleEl = document.createElement('style')
        styleEl.setAttribute('data-plugin', 'dsh-plugin-text-quote-en')
        styleEl.setAttribute('data-plugin-css', 'dsh-plugin-text-quote-en-styles-v1')
        styleEl.textContent = `
          .dsh-selection-menu{position:fixed;z-index:145;display:none;align-items:stretch;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:18px;background:var(--dsw-alias-bg-module-platform,#fff);box-shadow:0 6px 18px rgba(15,23,42,.16);overflow:hidden;font:13px Inter,"Segoe UI",Arial,sans-serif}.dsh-selection-menu button{min-height:34px;padding:0 12px;border:0;border-right:1px solid var(--dsw-alias-border-l2,#e2e8f0);color:var(--dsw-alias-label-primary,#17212b);background:transparent;cursor:pointer;font:inherit}.dsh-selection-menu button:last-child{border-right:0}.dsh-selection-menu button:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}
          .dsh-note-marker{position:fixed;z-index:138;width:28px;height:28px;place-items:center;padding:0;border:0;border-radius:14px;color:#fff;background:#1683f3;box-shadow:0 2px 6px rgba(22,131,243,.25);cursor:pointer;font:700 13px Inter,"Segoe UI",Arial,sans-serif}
          .dsh-note-editor{position:fixed;z-index:146;width:320px;min-height:150px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:18px;background:var(--dsw-alias-bg-module-platform,#fff);box-shadow:0 10px 28px rgba(15,23,42,.16);box-sizing:border-box}.dsh-note-editor textarea{display:block;width:100%;height:86px;padding:0;border:0;outline:0;resize:none;color:var(--dsw-alias-label-primary,#17212b);background:transparent;font:14px/1.5 Inter,"Segoe UI",Arial,sans-serif}.dsh-note-editor-actions{display:grid;grid-template-columns:34px 1fr auto auto;align-items:center;gap:8px}.dsh-note-editor-actions button{height:34px;padding:0 13px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:17px;background:transparent;color:var(--dsw-alias-label-primary,#17212b);cursor:pointer;font:13px Inter,"Segoe UI",Arial,sans-serif}.dsh-note-editor-actions .dsh-note-trash{padding:0;border:0;font-size:17px}.dsh-note-editor-actions .dsh-note-save{border-color:#17191c;color:#fff;background:#17191c;font-weight:600}
          .dsh-note-dock{position:relative;display:inline-flex;align-items:center;box-sizing:border-box;font:13px/1.45 Inter,"Segoe UI",Arial,sans-serif}.dsh-note-summary{display:flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:17px;color:var(--dsw-alias-label-primary,#17212b);background:var(--dsw-alias-bg-module-platform,#fff);cursor:pointer;font:inherit}.dsh-note-card{position:absolute;left:12px;bottom:42px;z-index:132;width:min(690px,calc(100vw - 48px));max-height:360px;padding:12px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:14px;background:var(--dsw-alias-bg-module-platform,#fff);box-shadow:0 10px 28px rgba(15,23,42,.16);overflow:auto;box-sizing:border-box}.dsh-note-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;padding:8px}.dsh-note-row+.dsh-note-row{border-top:1px solid var(--dsw-alias-border-l2,#e2e8f0)}.dsh-note-number{color:var(--dsw-alias-label-tertiary,#64748b)}.dsh-note-label{margin-bottom:2px;color:var(--dsw-alias-label-tertiary,#64748b)}.dsh-note-selected{margin-bottom:10px;color:var(--dsw-alias-label-primary,#17212b)}.dsh-note-comment{color:var(--dsw-alias-label-primary,#17212b)}.dsh-note-row-actions{display:flex;gap:2px}.dsh-note-row-actions button{width:28px;height:28px;padding:0;border:0;border-radius:5px;color:var(--dsw-alias-label-tertiary,#64748b);background:transparent;cursor:pointer;font-size:17px}.dsh-note-row-actions button:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}
          .dsh-sent-note-clean{white-space:pre-wrap}.dsh-sent-note-pill{display:flex;align-items:center;gap:6px;align-self:flex-end;height:34px;margin-top:8px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:17px;color:var(--dsw-alias-label-primary,#17212b);background:var(--dsw-alias-bg-module-platform,#fff);cursor:pointer;font:13px Inter,"Segoe UI",Arial,sans-serif}.dsh-sent-note-pill:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}.dsh-sent-note-popover{position:fixed;z-index:148;width:min(660px,calc(100vw - 32px));max-height:420px;padding:12px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:14px;color:var(--dsw-alias-label-primary,#17212b);background:var(--dsw-alias-bg-module-platform,#fff);box-shadow:0 10px 28px rgba(15,23,42,.18);overflow:auto;box-sizing:border-box;font:13px/1.5 Inter,"Segoe UI",Arial,sans-serif}.dsh-sent-note-popover .dsh-note-row{padding:10px 8px}
          .dsh-selection-details{position:fixed;z-index:147;display:flex;flex-direction:column;gap:8px;width:min(460px,calc(100vw - 24px));max-height:min(360px,calc(100vh - 24px));padding:12px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:14px;background:var(--dsw-alias-bg-module-platform,#fff);box-shadow:0 10px 28px rgba(15,23,42,.18);box-sizing:border-box;font:13px/1.5 Inter,"Segoe UI",Arial,sans-serif;color:var(--dsw-alias-label-primary,#17212b)}.dsh-details-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.dsh-details-title{font-weight:600}.dsh-details-close{width:26px;height:26px;padding:0;border:0;border-radius:13px;color:var(--dsw-alias-label-tertiary,#64748b);background:transparent;cursor:pointer;font-size:17px;line-height:1}.dsh-details-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}.dsh-details-text{flex:1;min-height:48px;overflow:auto;white-space:pre-wrap;word-break:break-word}.dsh-details-meta{color:var(--dsw-alias-label-tertiary,#64748b)}.dsh-details-actions{display:flex;justify-content:flex-end}.dsh-details-copy{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:15px;color:var(--dsw-alias-label-primary,#17212b);background:transparent;cursor:pointer;font:13px Inter,"Segoe UI",Arial,sans-serif}.dsh-details-copy:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}
           .dsh-sidechat{display:flex;flex-direction:column;height:100%;min-height:0;font:13px/1.45 Inter,"Segoe UI",Arial,sans-serif;color:var(--dsw-alias-label-primary,#17212b)}.dsh-sidechat-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e8f0);flex:none}.dsh-sidechat-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#64748b);font-weight:600;font-size:12px}.dsh-sidechat-actions{display:flex;align-items:center;gap:4px;flex:none}.dsh-sidechat-action{height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:13px;color:var(--dsw-alias-label-primary,#17212b);background:transparent;cursor:pointer;font:12px Inter,"Segoe UI",Arial,sans-serif;white-space:nowrap}.dsh-sidechat-action:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}.dsh-sidechat-notice{padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e8f0);color:var(--dsw-alias-label-tertiary,#64748b);font-size:12px;flex:none}.dsh-sidechat-conversation{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.dsh-sidechat-conversation>*{flex:1;min-height:0}.dsh-sidechat-empty{padding:16px;color:var(--dsw-alias-label-tertiary,#64748b)}.dsh-sidechat-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:200;max-width:min(520px,calc(100vw - 32px));padding:9px 14px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:10px;background:var(--dsw-alias-bg-module-platform,#fff);color:var(--dsw-alias-label-primary,#17212b);box-shadow:0 8px 24px rgba(15,23,42,.18);font:13px Inter,"Segoe UI",Arial,sans-serif}
        `
        document.head.appendChild(styleEl)
        return function() { styleEl.remove() }
      }, 'dsh-plugin-text-quote-en-styles-v1')
      ctx.slots.inject('conversation.input.left', function() { return ctx.slots.register({ name:'conversation.input.left', id:'text-quotes-en', order:30, label:'Conversation notes' }, NotesDock) })
      registerSideChat(ctx)
      ctx.effect(function() {
        var popover = null
        function closeSentPopover() { if (popover) popover.remove(); popover = null }
        function parseSent(text) {
          var start = text.lastIndexOf(START)
          var end = text.lastIndexOf(END)
          if (start < 0 || end < start) return null
          var block = text.slice(start + START.length, end)
          var clean = (text.slice(0, start) + text.slice(end + END.length)).trim()
          // Accept both this fork's English labels and the original Chinese
          // labels, so annotations sent before the fork still fold into a pill.
          var matches = Array.from(block.matchAll(/\[(?:Note|注释)\s+(\d+)\]\s*\n(?:Selected text:|所选文本：)\s*\n([\s\S]*?)\n(?:Your comment:|用户评论：)\s*\n([\s\S]*?)(?=\n\[(?:Note|注释)\s+\d+\]|\n<\/(?:conversation-notes|对话注释)>|$)/g))
          var notes = matches.map(function(match) { return { index:match[1], text:match[2].trim(), comment:match[3].trim() } })
          return notes.length ? { clean:clean, notes:notes } : null
        }
        function openSentPopover(button, notes) {
          closeSentPopover()
          var rect = button.getBoundingClientRect()
          popover = document.createElement('div')
          popover.className = 'dsh-sent-note-popover'
          notes.forEach(function(note) {
            var row = document.createElement('div')
            row.className = 'dsh-note-row'
            row.innerHTML = '<div class="dsh-note-number"></div><div class="dsh-note-body"><div class="dsh-note-label">Selected text:</div><div class="dsh-note-selected"></div><div class="dsh-note-label">Your comment:</div><div class="dsh-note-comment"></div></div>'
            row.querySelector('.dsh-note-number').textContent = note.index + '.'
            row.querySelector('.dsh-note-selected').textContent = note.text
            row.querySelector('.dsh-note-comment').textContent = note.comment
            popover.appendChild(row)
          })
          document.body.appendChild(popover)
          popover.style.left = Math.max(12, Math.min(window.innerWidth - popover.offsetWidth - 12, rect.right - popover.offsetWidth)) + 'px'
          popover.style.top = Math.max(12, rect.top - popover.offsetHeight - 8) + 'px'
        }
        function enhanceRow(row) {
          if (!row || row.dataset.dshAnnotationsEnhanced === 'true') return
          var parsed = parseSent(row.textContent || '')
          if (!parsed) return
          var stack = row.firstElementChild
          if (!stack) return
          row.dataset.dshAnnotationsEnhanced = 'true'
          Array.from(stack.children).forEach(function(child) { if ((child.textContent || '').indexOf(START) >= 0) child.style.display = 'none' })
          var clean = document.createElement('div')
          clean.className = 'dsh-sent-note-clean'
          clean.textContent = parsed.clean
          if (parsed.clean) stack.appendChild(clean)
          var pill = document.createElement('button')
          pill.type = 'button'
          pill.className = 'dsh-sent-note-pill'
          pill.innerHTML = '<span aria-hidden="true">&#9635;</span><span>' + plural(parsed.notes.length) + '</span>'
          pill.addEventListener('click', function(event) { event.stopPropagation(); if (popover) closeSentPopover(); else openSentPopover(pill, parsed.notes) })
          stack.appendChild(pill)
        }
        function scan() { document.querySelectorAll('[data-time-hover-root]').forEach(enhanceRow) }
        function onDocumentClick(event) { if (popover && !popover.contains(event.target) && !event.target.closest('.dsh-sent-note-pill')) closeSentPopover() }
        var observer = new MutationObserver(scan)
        observer.observe(document.body, { childList:true, subtree:true })
        document.addEventListener('click', onDocumentClick)
        scan()
        return function() { observer.disconnect(); document.removeEventListener('click', onDocumentClick); closeSentPopover() }
      }, 'dsh-plugin-text-quote-en-sent-rendering-v1')
      ctx.effect(function() {
        selectionMenu = document.createElement('div')
        selectionMenu.className = 'dsh-selection-menu'
        selectionMenu.innerHTML = '<button type="button">Add to conversation</button><button type="button">More details</button><button type="button">Ask in side chat</button>'
        document.body.appendChild(selectionMenu)
        selectionMenu.children[0].addEventListener('click', function() {
          if (!pendingSelection) return
          var selected = pendingSelection
          pendingSelection = null
          openEditor(null, selected.text, selected.range, selected.rect)
          var selection = window.getSelection()
          if (selection) selection.removeAllRanges()
        })
        selectionMenu.children[1].addEventListener('click', function() {
          if (!pendingSelection) return
          var selected = pendingSelection
          pendingSelection = null
          openDetails(selected)
        })
        selectionMenu.children[2].addEventListener('click', function() {
          if (!pendingSelection) return
          var selected = pendingSelection
          pendingSelection = null
          closeSelectionMenu()
          var selection = window.getSelection()
          if (selection) selection.removeAllRanges()
          askInSideChat(ctx, selected.text)
        })
        function inspectSelection() {
          var selection = window.getSelection()
          if (!selection || selection.isCollapsed || !selection.rangeCount) { closeSelectionMenu(); return }
          var node = selection.anchorNode && (selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement)
          if (!node || node.closest('textarea,input,[contenteditable="true"],.dsh-selection-menu,.dsh-note-editor,.dsh-note-card,.dsh-selection-details')) { closeSelectionMenu(); return }
          var text = selection.toString().trim()
          if (!text) { closeSelectionMenu(); return }
          var range = selection.getRangeAt(0).cloneRange()
          var rect = range.getBoundingClientRect()
          pendingSelection = { text:text.slice(0,6000), range:range, rect:rect }
          selectionMenu.style.left = Math.max(8, Math.min(window.innerWidth - 380, rect.left + 8)) + 'px'
          selectionMenu.style.top = Math.max(8, rect.top - 42) + 'px'
          selectionMenu.style.display = 'flex'
        }
        function onMouseUp(event) { if (!selectionMenu.contains(event.target)) setTimeout(inspectSelection, 0) }
        function onScroll(event) {
          var target = event && event.target
          if (target && target.closest && target.closest('.dsh-selection-details,.dsh-note-editor,.dsh-note-card')) return
          closeSelectionMenu(); closeDetails(); renderMarkers()
        }
        function onClickCapture(event) {
          var card = event.target && event.target.closest ? event.target.closest('[data-composer-card]') : null
          var button = event.target && event.target.closest ? event.target.closest('button') : null
          if (!card || !button || button.getAttribute('aria-haspopup')) return
          var buttons = Array.from(card.querySelectorAll('button'))
          if (buttons[buttons.length - 1] !== button) return
          if (injectBeforeSubmit()) { event.preventDefault(); event.stopPropagation() }
        }
        function onKeyCapture(event) {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !event.target || !event.target.closest || !event.target.closest('[data-composer-card] textarea')) return
          if (injectBeforeSubmit()) { event.preventDefault(); event.stopPropagation() }
        }
        document.addEventListener('mouseup', onMouseUp)
        document.addEventListener('scroll', onScroll, true)
        document.addEventListener('click', onClickCapture, true)
        document.addEventListener('keydown', onKeyCapture, true)
        return function() {
          document.removeEventListener('mouseup', onMouseUp)
          document.removeEventListener('scroll', onScroll, true)
          document.removeEventListener('click', onClickCapture, true)
          document.removeEventListener('keydown', onKeyCapture, true)
          closeDetails(); closeEditor(); closeSelectionMenu()
          if (selectionMenu) selectionMenu.remove()
          selectionMenu = null
          markers.forEach(function(map) { map.forEach(function(marker) { marker.remove() }) })
          markers.clear()
        }
      }, 'dsh-plugin-text-quote-en-interactions-v1')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
