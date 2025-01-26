import { useRef } from 'preact/hooks'
import { PromptMessage } from '@utils/types'

function App() {
  const input = useRef<HTMLTextAreaElement>(null)
  const sendMessage = (obj: Partial<PromptMessage>) => chrome.runtime.sendMessage<PromptMessage>({ ...obj, type: 'prompt' })

  const resetSession = () => sendMessage({ reset: true })
  const process = () => sendMessage({ prompt: input.current!.value })

  return (
    <div class="h-full w-full">
      <textarea
        ref={input}
        class="b-2 b-black p-2 text-xl"
        placeholder="Perintah atau pertanyaan"
        rows={3}
      />
      <button
        class="b-2 b-black p-8 w-full bg-red text-2xl fw-bold"
        onClick={process}
        type="submit"
      >
        GASKAN!
      </button>
      <button
        class="b-2 b-black p-4 w-full bg-blue text-lg"
        onClick={resetSession}
      >
        Start new session
      </button>
    </div>
  );
}

export default App;
