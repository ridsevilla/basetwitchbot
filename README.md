# basetwitchbot

## Installation

First, setup [Node.js](https://nodejs.org/en/).

Install the following:

```
npm install web3 bignumber.js sqlite3 tmi.js
```

Edit `config-default.json` with the appropriate values and save as `config.json`.

Please use appropriate measures to secure your credentials before using in production.

You may generate your bot's Twitch OAuth Token with [https://twitchapps.com/tmi/](https://twitchapps.com/tmi/) (a Twitch community-driven wrapper around the Twitch API), while logged in to your bot's Twitch account. The token will be an alphanumeric string. To use in a production setting, it is recommended that you register your bot with Twitch and use a more secure OAuth Authorization code flow.

To run `basetwitchbot`:

```
node index.js
```

## Usage

```
streamer commands:
-send base eth: !beth <amount> <twitch-viewer-tag>
-rain base eth: !bethrain <amount>
-send base usdc: !busdc <amount> <twitch-viewer-tag>
-rain base usdc: !busdcrain <amount>

viewer commands:
-set base wallet: !base <address>
-view base wallet: !base

notes:
-shortform for !base: !ba
-can interchange ! with $
```

## Thanks

Thanks to animokaiman, cautionfun, and rckmtl!

---

Base: [ridsevilla.base.eth](https://basescan.org/address/0x251870Dd36C71f980D903246D694A9EA04Ec3865)
