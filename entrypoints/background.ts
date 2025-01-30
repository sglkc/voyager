import { Message, PromptMessage } from '@utils/types'
import { getAction, getActionRunner } from '@utils/runner'

const MAX_STEPS: number = 5
let session: string | undefined

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    windowType: 'normal',
  })

  return tab ?? { id: 0 }
}

async function PromptRunner(msg: PromptMessage) {
  const { prompt } = msg
  let lastAction = undefined
  let lastPage = ''
  let steps = 0

  while (steps < MAX_STEPS) {
    // wait for tab id if empty
    const { id: tabId, url, status } = await getActiveTab()

    if (!tabId) {
      await sleep(5000)
      steps++
      continue
    }

    // wait for tab loading (TODO: timeout?)
    if (status !== 'complete') {
      let callback: any = (res: Function) =>
        (id: number, info: chrome.tabs.TabChangeInfo) => {
          if (id !== tabId || info.status !== 'complete') return
          res()
        }

      console.log('waiting loading')
      await new Promise<void>((res) => {
        callback = callback(res)
        chrome.tabs.onUpdated.addListener(callback)
      })

      chrome.tabs.onUpdated.removeListener(callback)
      console.log('finished loading')
    }

    // get page and compare if changed
    const [injection] = await chrome.scripting.executeScript<any, string>({
      target: { tabId },
      files: ['content-scripts/markdown.js']
    })

    const newPage = injection.result ?? ''
    const page = newPage !== lastPage ? newPage : undefined

    // fetch action from api
    const action = await getAction({ session, url, prompt, page })
      .catch((err: Error) => {
        handleMessage({
          type: 'NOTIFY',
          audio: 'error',
          message: 'Error occured while fetching agent: ' + err.name,
        })
      })

    if (!action) break

    // apply user session if empty
    if (!session)
      session = action.session

    handleMessage({
      type: 'NOTIFY',
      audio: 'process',
      message: `[${action.action}] ${action.intent}`,
    })

    // wait a bit for response
    await playTTS(action.intent)

    // run action to user page
    const runner = getActionRunner(action)
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: runner,
      args: [action]
    })

    console.info(JSON.stringify(action, null, 1))

    if (!execution.result) {
      lastAction = action
      break
    }

    // wait a bit for response
    await sleep(3000)

    handleMessage({
      type: 'NOTIFY',
      audio: 'process',
      message: 'Continuing agent...',
    })

    // await sleep(5000)
    lastPage = newPage
    steps++
  }

  const message = lastAction && lastAction.target ? lastAction.target : 'Max steps reached'

  playTTS(message)
  handleMessage({
    type: 'NOTIFY',
    audio: 'finish',
    message: '[DONE] ' + message
  })
}

async function playTTS(text: string): Promise<void> {
  return new Promise((resolve) => {
    const handler = (msg: Message) => {
      if (msg.type !== 'TTS' || msg.kind === 'text') return
      chrome.runtime.onMessage.removeListener(handler)
      resolve()
    }

    chrome.runtime.onMessage.addListener(handler)
    handleMessage({ type: 'TTS', kind: 'text', text })
  })
}
async function handleMessage(msg: Message) {
  if (typeof msg !== 'object' || !msg.type) return

  // forward to content scripts
  const { id: tabId } = await getActiveTab()
  if (tabId) {
    chrome.tabs.sendMessage(tabId, msg).catch(() => null)
  }

  // forward to other things (popup or offscreen)
  chrome.runtime.sendMessage(msg).catch(() => null)

  switch (msg.type) {
    case 'PROMPT':
      PromptRunner(msg)
      break
    case 'RESET-SESSION':
      session = undefined
      break
    case 'NOTIFY':
      // forward audio
      if (msg.audio) {
        handleMessage({
          type: 'AUDIO',
          audio: msg.audio
        })
      }
      break
    case 'AUDIO':
      // create offscreen document for audio autoplay
      chrome.offscreen.createDocument({
        url: '/offscreen.html?audio=' + msg.audio,
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'autoplay can not play'
      }).catch(() => null)
      break
    case 'TTS':
      // listener in offscreen
      if (msg.kind !== 'text') return

      // create offscreen document for audio autoplay
      chrome.offscreen.createDocument({
        url: '/offscreen.html?tts=' + msg.text,
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'autoplay can not play'
      }).catch(() => null)
      break
    default:
      console.error('Undefined message type', msg)
  }
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(handleMessage)

  // commands for shortcut keys
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-popup') {
      chrome.action.openPopup()
    }
  })

  // ensure microphone permission for speech recognition on first install
  chrome.runtime.onInstalled.addListener((e) => {
    if (e.reason === chrome.runtime.OnInstalledReason.INSTALL)
      chrome.runtime.openOptionsPage()
  })
})
