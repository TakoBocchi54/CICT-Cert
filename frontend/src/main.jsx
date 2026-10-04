import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Web3AuthProvider } from '@web3auth/modal/react'
import { web3AuthContextConfig } from './web3authconfig.js'
import { WagmiProvider } from '@web3auth/modal/react/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Web3AuthProvider config={web3AuthContextConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider>
          <App />
        </WagmiProvider>
      </QueryClientProvider>
    </Web3AuthProvider>
  </StrictMode>,
)
