// ————————————————————————————————————————————————————————————
// useCall — real WebRTC audio/video between matched peers.
//
// The two strangers are already paired by Match (Supabase Realtime
// blind-match), so the SDP/ICE negotiation rides that same relay —
// no codes, no new accounts. Media flows peer-to-peer via WebRTC.
//
// STUN-only for now: works on most home networks. Symmetric NAT /
// restrictive corporate networks may need a TURN server later.
// ————————————————————————————————————————————————————————————

import { useCallback, useEffect, useRef, useState } from 'react'
import { Match } from './match.js'

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
  ],
}

/**
 * @param {{ enabled: boolean, amOfferer: boolean }} opts
 * `enabled` turns the call on/off (false = demo, no peer to reach).
 * `amOfferer` picks exactly one side to create the offer (no glare).
 */
export function useCall({ enabled, amOfferer }) {
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [status, setStatus] = useState('idle') // idle | connecting | connected | failed
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [camFailed, setCamFailed] = useState(false)

  const pcRef = useRef(null)
  const localRef = useRef(null)
  const queueRef = useRef([]) // signals arriving before the pc is ready

  /* stable inbound-signal handler (reads the pc via ref) */
  const handleSignal = useCallback((sig) => {
    const pc = pcRef.current
    if (!pc) {
      queueRef.current.push(sig)
      return
    }
    ;(async () => {
      try {
        if (sig.description) {
          await pc.setRemoteDescription(sig.description)
          // remote description set — flush any candidates that raced ahead
          for (const q of queueRef.current) {
            if (q.candidate) {
              try { await pc.addIceCandidate(q.candidate) } catch { /* noop */ }
            }
          }
          queueRef.current = []
          if (sig.description.type === 'offer') {
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            Match.sendSignal({ description: pc.localDescription })
          }
        } else if (sig.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(sig.candidate)
          else queueRef.current.push(sig)
        }
      } catch {
        /* a mid-negotiation hiccup shouldn't kill the session */
      }
    })()
  }, [])

  /* listen for the peer's SDP/ICE over the relay */
  useEffect(() => {
    if (!enabled) return
    return Match.on('remote-signal', handleSignal)
  }, [enabled, handleSignal])

  /* capture local media (always — self preview in demo too) + build the connection */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setStatus(enabled ? 'connecting' : 'idle')
        // Demo: video-only self preview. Real: add audio for the call.
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: enabled })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        localRef.current = stream
        setLocalStream(stream)

        if (!enabled) return // demo has no peer — self preview only

        const pc = new RTCPeerConnection(RTC_CONFIG)
        pcRef.current = pc
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        pc.ontrack = (e) => setRemoteStream(e.streams?.[0] || null)
        pc.onicecandidate = (e) => {
          if (e.candidate) Match.sendSignal({ candidate: e.candidate })
        }
        pc.onconnectionstatechange = () => {
          const st = pc.connectionState
          if (st === 'connected') setStatus('connected')
          else if (st === 'failed' || st === 'closed') setStatus('failed')
        }

        // signals that beat the pc into existence
        const early = queueRef.current
        queueRef.current = []
        early.forEach((s) => handleSignal(s))

        if (amOfferer) {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          Match.sendSignal({ description: pc.localDescription })
        }
      } catch {
        if (!cancelled) {
          setCamFailed(true)
          setStatus(enabled ? 'failed' : 'idle')
        }
      }
    })()

    return () => {
      cancelled = true
      localRef.current?.getTracks().forEach((t) => t.stop())
      localRef.current = null
      try { pcRef.current?.close() } catch { /* noop */ }
      pcRef.current = null
      queueRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, amOfferer, handleSignal])

  /* keep real tracks in sync with the toggles (mute = disable, no renegotiation) */
  useEffect(() => {
    const track = localRef.current?.getVideoTracks()[0]
    if (track) track.enabled = camOn
  }, [camOn, localStream])

  useEffect(() => {
    const track = localRef.current?.getAudioTracks()[0]
    if (track) track.enabled = micOn
  }, [micOn, localStream])

  const toggleCam = useCallback(() => setCamOn((p) => !p), [])
  const toggleMic = useCallback(() => setMicOn((p) => !p), [])

  return {
    localStream,
    remoteStream,
    status,
    camOn,
    micOn,
    camFailed,
    toggleCam,
    toggleMic,
  }
}
