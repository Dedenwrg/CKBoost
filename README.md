# CKBoost - Gamified Community Engagement Platform

> [!IMPORTANT]
> This project is currently under active development as part of the Nervos Community Catalyst initiative and is not yet ready for production use.

A purpose-built open-source gamified engagement platform for the CKB ecosystem, designed to transform community engagement from scattered, ad-hoc efforts into a structured, rewarding, and measurable system that drives participation, incentivizes real contributions, and encourages ecosystem growth.

## 🎯 Mission

CKBoost directly supports the goals of the [Nervos Community Catalyst](https://talk.nervos.org/t/nervos-community-catalyst/8128) initiative by providing the technical backbone for:

- **Structured Engagement**: Transform random community efforts into organized campaigns with clear goals
- **Verifiable Contributions**: Implement "proof of participation" for all types of community activities
- **Fair Rewards**: Distribute on-chain rewards transparently based on actual contributions
- **Ecosystem Growth**: Drive both off-chain engagement and on-chain activity through gamification

## 🌟 Overview

CKBoost addresses key challenges in community management:

- **Inclusive Participation**: Reward community members who don't have directly transferable skills for formal tracks
- **Synergized Effort**: Coordinate community action across social media, off-chain, and on-chain platforms
- **Fun & Incentivized**: Create enthusiasm for participation through gamification and rewards
- **On-Chain Activity**: Leverage CKB features and encourage more blockchain interaction

### Key Features

- **Campaign & Quest Management**: Multi-quest campaigns with on-chain configuration, Nostr-backed submission storage, and admin/staff dashboard for review/approval/reward distribution flows
- **On-Chain Points & Badges**: Points UDT and achievement scripts with reward history/leaderboard services tracing mint transactions for transparent payouts;
- **Gamification Elements**: Streak bonus and achievement validators in serverless functions, and leaderboard;
- **Anti-Sybil Verification**: Telegram login + on-chain binding live in the identity flow, with DID/KYC and other methods on the roadmap
- **Community Tipping**: Peer recognition system with democratic approval flow and automated payouts from both community treasury and personal tippers;
- **Comprehensive Dashboards**: Platform admin (protocol + approvals), campaign admin (staff + quest reviews), contributor dashboard/leaderboard/profile/tipping views

## 🏗️ Project Structure

```
CKBoost/
├── dapp/                    # Next.js frontend application
│   ├── app/                 # App Router pages and layouts
│   ├── components/          # Reusable UI components
│   ├── lib/                 # Business logic and data management
│   │   ├── types/           # TypeScript type definitions
│   │   ├── mock/            # Development mock data
│   │   ├── ckb/             # Blockchain integration layer
│   │   ├── providers/       # React context providers
│   │   └── services/        # Data service abstraction
│   ├── netlify/functions/   # Serverless APIs (social interactions, achievements, streaks, staff approvals, Telegram auth)
│   └── ...                  # Standard Next.js structure
├── contracts/               # Smart contracts
│   ├── contracts/           # Individual contract implementations
│   │   ├── ckboost-achievement-type/    # Achievement management logic
│   │   ├── ckboost-campaign-type/    # Campaign management logic
│   │   ├── ckboost-funding-lock/    # Secure fund vaults
│   │   ├── ckboost-protocol-type/    # Governance
│   │   ├── ckboost-protocol-lock/    # Protocol governance
│   │   ├── ckboost-user-type/        # Submission, verification, and social bindings
│   │   ├── ckboost-points-udt/       # Points UDT for rewards
│   │   ├── ckboost-tipping-type/       # tipping management
│   │   └── ckboost-shared/           # Common utilities
│   └── tests/               # Integration tests
├── docs/                    # Documentation and specifications
│   ├── recipes/             # Transaction skeleton definitions
│   └── *.prd.txt           # Product requirements documents
└── schemas/                 # Molecule schema definitions
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ with **pnpm**
- **Rust** toolchain for contract development
- **CKB Node** for blockchain interaction (development/testnet)

### Quick Start

1. **Clone the repository**

   ```bash
   git clone https://github.com/Alive24/CKBoost.git
   cd CKBoost
   ```

2. **Start the application (dApp and serverless functions)**

   Set `dapp/.env.local` (RPC/indexer URLs, `NEXT_PUBLIC_SSRI_EXECUTOR_URL`, `NEXT_PUBLIC_PROTOCOL_TYPE_ARGS` from `deployment-summary.md` or `deployments.json`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, etc.) using `dapp/DEPLOYMENT.md` as a reference.

   ```bash
   cd dapp
   netlify dev
   ```

   The application will be available at `http://localhost:9003` (depending on the port you set in `dapp/netlify.toml`)

3. **Build smart contracts** (optional for frontend development)
   ```bash
   cd contracts
   make build
   ```

## 🛠️ Technical Architecture

### Decentralized Design Philosophy

CKBoost implements a new pattern of decentralization for dApps:

- **Serverless Functions Backend**: Serverless functions in-repo shipped alongside the dApp; no need to host them on private servers.
- **Transparent Infrastructure**: All modules and code are open-sourced, and complete for anyone to deploy its own instance;deployment records/logs publicly available for transparency and auditability.
- **Decentralized Data Storage**: CKB Cell data for all on-chain states; Nostr relays for metadata and content; local cache in serverless functions for performance optimization.

### Technology Stack

#### Frontend (dApp)

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS with shadcn/ui components
- **State Management**: React Context with CKB CCC integration
- **Wallet Integration**: @ckb-ccc/connector-react for universal wallet support
- **Data Layer**: Abstracted service layer supporting mock and blockchain data with Nostr-backed off-chain submissions and social interactions

#### Smart Contracts

- **ckboost-protocol-type**: Governance & Points UDT minting
- **ckboost-protocol-lock**: Protocol governance and treasury management
- **ckboost-campaign-type**: Campaign logic and quest management
- **ckboost-funding-lock**: Secure vaults for campaign funds
- **ckboost-user-type**: Submission, verification, and social bindings
- **ckboost-points-udt**: Points UDT for rewards
- **ckboost-tipping-type**: Tipping management

#### Decentralized API Services

- **Infrastructure**: Netlify Functions in this repo (social interactions, streak/achievement validators, Telegram auth, staff approvals, reward history) with optional Cloudflare Worker deployment
- **Hosting**: By campaign sponsors and community members
- **Purpose**: Indexing, proof validation, staff approvals, and coordination

#### Data Storage Strategy

- **Critical State**: CKB Cell data for all on-chain states and reference to off-chain data;
- **Non-Critical Data**: Nostr relays for metadata and content;
- **Performance**: local cache in serverless functions for performance optimization.

## 📋 Core User Flows

### Campaign Creation Flow

Define quests → Fund campaign (CKB/UDT) → Assign staff reviewers → Get admin approval via protocol dashboard → Launch with Connected Type IDs → Monitor submissions/approvals → Distribute rewards

### Contributor Flow

Connect wallet → Complete Telegram verification → Browse campaigns → Complete tasks → Submit proof (stored via Nostr) → Pass staff approval → Claim rewards/points → Earn badges & ranking

### Tipping Flow

Propose tip with event link → Receive peer approvals → On-chain funding + explorer link → Permanent profile record with Nostr comments/likes

### Admin Flow

Identity verification → Campaign sponsor verification → Protocol/campaign approval → Staff approvals + quest reviews → Base campaign creation

## 🎮 Example Campaign Types

- **AMA Boost**: Points for questions, shares, and Nervos discussion amplification
- **Knowledge Boost**: Share and summarize Knowledge Base articles
- **On-Chain Quests**: Lock CKB for iCKB, add DEX liquidity, interact with DeFi
- **Community Governance**: Engage with proposals and provide feedback

## 🔐 Security & Risk Management

### Security Measures

- **Escrow Protection**: Funding lock scripts protect all escrowed assets
- **Multi-Signature**: Support for high-value campaign management
- **Time Locks**: Campaign duration enforcement and deadline management
- **Gradual Rollout**: Small initial contract funds with progressive scaling and stricter transaction input validation across core scripts

### Anti-Sybil Protection

- **Locked Rewards**: Rewards remain locked until verification passes
- **Multi-Method Verification**: Telegram, DID, KYC, and manual review options
- **Reputation System**: Build trust through consistent participation

## 📈 Development Roadmap

### Milestone 1: Foundation & Core MVP (~Month 1)

- ✅ Next.js scaffold with CCC wallet integration
- ✅ Visual and interaction prototyping
- ✅ Smart contract development for core scripts (campaign, user, protocol, funding, points, tipping, achievement all implemented and testnet-deployed)
- ✅ Campaign & quest creation flows (platform/campaign admin dashboards, Nostr-backed submissions, staff approvals)
- 🔄 Points UDT and reward distribution (UDT deployed with reward history + leaderboard services; automated distribution in tuning)

### Milestone 2: Advanced Features (~Month 2)

- 🔄 Expanded verification methods (Telegram bot + on-chain binding live; DID/KYC next)
- ✅ Leaderboards and user profiles (dashboard/profile pages wired to chain data and reward history)
- 🔄 Gamification features (streaks, multipliers, badges) with streak bonus + achievement validators shipped
- ✅ Tipping system with peer approvals (tipping proposals, approvals, Nostr comments/likes, explorer links)
- ✅ Admin dashboard and analytics (protocol + campaign admin consoles, staff review queues, tipping stats)

### Milestone 3: Launch Preparation (~Month 3)

- 📅 Deploy test campaigns with real users
- 🔄 Automated on-chain verification (transaction validation and proxy handling added; end-to-end automation pending)
- 🔄 Documentation and onboarding guides (deployment summary + Netlify/Telegram setup in place; broader docs in progress)
- 📅 Final testing and optimization
- 📅 Community feedback integration

## 💰 Funding

This project is funded by the CKB Community Fund DAO:

- **Total Grant**: $20,000 USD
- **Payment Structure**: 10% upfront, 90% across 3 milestones
- **Timeline**: 3 months from commencement
- **Purpose**: Support design, development, and deployment of CKBoost

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** following the coding standards
4. **Add tests** for new functionality
5. **Submit a pull request** with clear description

### Development Standards

- **TypeScript**: Strict type checking enabled
- **Code Quality**: ESLint/Prettier for formatting
- **Commits**: Conventional commit format
- **Testing**: High coverage for critical paths

## 📚 Documentation

### For Users

- **Campaign Creation Guide**: How to launch engaging campaigns
- **Quest Participation**: How to complete quests and earn rewards
- **Verification Guide**: Understanding identity requirements
- **Tipping System**: How to recognize exceptional contributions

### For Developers

- **Architecture Overview**: Understanding the decentralized design
- **Contract Interface**: Smart contract specifications
- **API Documentation**: Decentralized service APIs
- **Integration Guide**: Adding CKBoost to your project

### Key Resources

- [Grant Proposal](https://talk.nervos.org/t/dis-ckboost-gamified-community-engagement-platform-proposal)
- [UI/UX Demo](https://ckboost.netlify.app/)
- [Technical Specifications](docs/ckboost-platform.prd.txt)
- [Transaction Recipes](docs/recipes/)
- [Deployment Summary](deployment-summary.md)
- [Netlify/Telegram Deployment Guide](dapp/DEPLOYMENT.md)

## Utilities

### Size Analysis

cargo bloat --release --target riscv64imac-unknown-none-elf --crates --package ckboost-campaign-type

## 🌐 Deployment

### Netlify Frontend

```bash
# Automatic deployment on push to main branch
git push origin main
```

Netlify Functions (Telegram auth, staff approvals, streak/achievement validators, social interactions, reward history) deploy alongside the frontend build; use `netlify dev` to run them locally.

### Decentralized Services

```bash
# Serverless APIs (Netlify Functions) shipped in this repo
cd dapp
netlify dev --functions netlify/functions

# Optional: deploy Cloudflare Worker variant
# cd services
# wrangler deploy
```

### Smart Contracts

```bash
cd contracts
make deploy-testnet    # Deploy to CKB testnet
make deploy-mainnet    # Deploy to CKB mainnet
```

Type IDs and code hashes are tracked in `deployments.json`; copy the protocol type args into `NEXT_PUBLIC_PROTOCOL_TYPE_ARGS` for the dApp.

## 🆘 Support & Community

- **GitHub Issues**: [Report bugs or request features](https://github.com/Alive24/CKBoost/issues)
- **Discussions**: [Join the conversation](https://github.com/Alive24/CKBoost/discussions)
- **Nervos Talk**: [Community discussions](https://talk.nervos.org/)
- **Documentation**: [Full documentation](docs/)

## 🙏 Acknowledgments

- **Nervos Community Catalyst** for sponsoring this initiative
- **CKB Community Fund DAO** for funding support
- **Nervos Foundation** for the innovative CKB blockchain
- **Community Contributors** who make this project possible

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Built with ❤️ by Alive24 for the Nervos Community**
