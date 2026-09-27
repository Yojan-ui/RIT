import { Component, type ReactNode } from 'react'

/** Keeps the terminal usable on machines without WebGL: the 3D view degrades to a note. */
export class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <p className="grid h-full place-items-center p-4 text-center font-mono text-2xs text-dim">3D view unavailable (WebGL is off)</p>
    }
    return this.props.children
  }
}
