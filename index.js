// initialize config
var { baseRpcUrl, basePrivateKey, twitchChannel, twitchUsername, twitchOauthToken } = require('./config.json');
twitchChannel = twitchChannel.toLowerCase();
twitchUsername = twitchUsername.toLowerCase();

// initialize database
const sqlite3 = require('sqlite3');
const viewers_db = new sqlite3.Database('./viewers.db');
viewers_db.run("CREATE TABLE IF NOT EXISTS viewers (userid TEXT, username TEXT, base_address TEXT, base_status INT, updated_at TEXT)", [], (err) => {
  if (err) {
    console.log(err.message);
  }
});

// initialize base rpc client
const { Web3 } = require('web3');
const web3 = new Web3(baseRpcUrl);
const signer = web3.eth.accounts.privateKeyToAccount(basePrivateKey);
const chainId = 8453;
const erc20_abi = [
  {
    "constant": true,
    "inputs": [
      {
        "name": "_owner",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "name": "balance",
        "type": "uint256"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [
      {
        "name": "_to",
        "type": "address"
      },
      {
        "name": "_value",
        "type": "uint256"
      }
    ],
    "name": "transfer",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
    ],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
];
const usdc_tokenAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const usdc_contract = new web3.eth.Contract(erc20_abi, usdc_tokenAddress, { from: signer.address } );

// initialize twitch client
const tmi = require('tmi.js');
const twitchClient = new tmi.Client({
        options: { debug: false },
        connection: {
                secure: true,
                reconnect: true
        },
        identity: {
                username: twitchUsername,
                password: twitchOauthToken
        },
        channels: [ twitchChannel ]
});
twitchClient.connect().then((data) => {}).catch((err) => {});
twitchClient.on('message', (channel, tags, message, self) => {
  if (self) return;
  var username = tags.username;
  var userid = tags['user-id'];
  processMessage(channel, message, username, userid);
});


const BigNumber = require('bignumber.js');
const https = require('https');

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const getTwitchChatters = (channel) => {
  if (channel.startsWith('#')) {
    channel = channel.substr(1);
  }
  var chatters = [];
  var rest_options = {
    host: 'gql.twitch.tv',
    port: 443,
    path: '/gql',
    method: 'POST',
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
    }
  }
  var post_data = {
    operationName: 'ChatViewers',
    variables: {
        channelLogin: channel
        },
    extensions: {
        persistedQuery: {
            version: 1,
            sha256Hash: 'e0761ef5444ee3acccee5cfc5b834cbfd7dc220133aa5fbefe1b66120f506250'
            }
        }
  }
  return new Promise ((resolve, reject) => {
    var request = https.request(rest_options, (response) => {
      var content = "";
      response.on('data', function(chunk) {
        content += chunk;
      });
      response.on('end', function() {
        try {
          let data = JSON.parse(content);
          if (data.data.channel.chatters.staff !== undefined) {
            data.data.channel.chatters.staff.forEach(function(staff) {
              chatters.push(staff.login);
            });
          }
          if (data.data.channel.chatters.moderators !== undefined) {
            data.data.channel.chatters.moderators.forEach(function(moderator) {
              chatters.push(moderator.login);
            });
          }
          if (data.data.channel.chatters.vips !== undefined) {
            data.data.channel.chatters.vips.forEach(function(vip) {
              chatters.push(vip.login);
            });
          }
          if (data.data.channel.chatters.viewers !== undefined) {
            data.data.channel.chatters.viewers.forEach(function(viewer) {
              chatters.push(viewer.login);
            });
          }
          resolve(chatters);
          return;
        }
        catch(error) {
          reject('invalid response from api server');
          return;
        }
      });
    });
    request.write(JSON.stringify(post_data));
    request.on('error', function(error) {
      reject('error while calling api endpoint');
    });
    request.end();
  });
}

const rawToUsdc = (amount) => {
  var multRaw = new BigNumber(0.000001);
  var usdc = multRaw.times(amount);
  return parseFloat(usdc.toFixed());
}

const usdcToRaw = (amount) => {
  var multRaw = new BigNumber(1000000);
  var raw = multRaw.times(amount);
  return parseFloat(raw.toFixed());
}

const getBaseEthBalance = (address) => {
  return new Promise ((resolve, reject) => {
    (async () => {
      try {
        let eth_balance = await web3.eth.getBalance(address);
        eth_balance = web3.utils.fromWei(eth_balance, "ether");
        resolve(parseFloat(eth_balance));
      } catch (err) {
        reject("balance could not be retrieved");
      }
    })();
  });
}

const getBaseUsdcBalance = (address) => {
  return new Promise ((resolve, reject) => {
    (async () => {
      try {
        let usdc_balance = await usdc_contract.methods.balanceOf(signer.address).call();
        usdc_balance = rawToUsdc(Number(usdc_balance));
        resolve(parseFloat(usdc_balance));
      } catch (err) {
        reject("balance could not be retrieved");
      }
    })();
  });
}

const sendBaseEth = (address, amount) => {
  return new Promise ((resolve, reject) => {
    amount = parseFloat(amount);
    if (address == signer.address) {
      resolve("success");
      return;
    }
    (async () => {
      try {
        let gas_limit = Number(await web3.eth.estimateGas({from: signer.address}));
        let base_fee = Number((await web3.eth.getBlock("pending")).baseFeePerGas);
        let max_priority_fee_per_gas = Number(await web3.eth.getMaxPriorityFeePerGas());
        const tx = {
          from: signer.address,
          to: address,
          value: web3.utils.toWei(amount, "ether"),
          gas: Math.round(gas_limit * 1.03),
          nonce: await web3.eth.getTransactionCount(signer.address),
          maxPriorityFeePerGas: max_priority_fee_per_gas,
          maxFeePerGas: max_priority_fee_per_gas + base_fee,
          chainId: chainId,
          type: 0x2,
        };
        const signedTx = await web3.eth.accounts.signTransaction(tx, signer.privateKey);
        try {
          const receipt = await web3.eth
            .sendSignedTransaction(signedTx.rawTransaction)
            .once("transactionHash", (txhash) => {
            });
          resolve('success');
        } catch (err) {
          reject('insufficient funds');
        }
      } catch (err) {
        reject('error estimating gas');
      }
    })();
  });
}

const sendBaseUsdc = (address, amount) => {
  return new Promise ((resolve, reject) => {
    amount = usdcToRaw(amount);
    if (address == signer.address) {
      resolve("success");
      return;
    }
    (async () => {
      try {
        let gas_limit = Number(await usdc_contract.methods.transfer(address,amount).estimateGas({from: signer.address}));
        let base_fee = Number((await web3.eth.getBlock("pending")).baseFeePerGas);
        let max_priority_fee_per_gas = Number(await web3.eth.getMaxPriorityFeePerGas());
        const tx = {
          from: signer.address,
          to: usdc_tokenAddress,
          value: '0x0',
          data: usdc_contract.methods.transfer(address,amount).encodeABI(),
          gas: Math.round(gas_limit * 1.03),
          nonce: await web3.eth.getTransactionCount(signer.address),
          maxPriorityFeePerGas: max_priority_fee_per_gas,
          maxFeePerGas: max_priority_fee_per_gas + base_fee,
          chainId: chainId,
          type: 0x2,
        };
        const signedTx = await web3.eth.accounts.signTransaction(tx, signer.privateKey);
        try {
          const receipt = await web3.eth
            .sendSignedTransaction(signedTx.rawTransaction)
            .once("transactionHash", (txhash) => {
            });
          resolve('success');
        } catch (err) {
          reject('insufficient funds');
        }
      } catch (err) {
        reject('error estimating gas');
      }
    })();
  });
}

const setBaseAddress = (userid, username, address) => {
  return new Promise ((resolve, reject) => {
    (async () => {
      var valid = 0;
      var eth_regex = /^0x[a-fA-F0-9]{40}$/;
      if (address == null || address == '') {
        valid = 1;
      }
      else if (eth_regex.test(address)) {
        try {
          let checksum = web3.utils.toChecksumAddress(address);
          address = checksum;
          valid = 1;
        } catch(error) {
          reject('base address is not valid');
          return;
        }
      }
      if (valid == 1) {
        viewers_db.serialize(function() {
          viewers_db.get("SELECT * FROM viewers WHERE userid = ?", [data.userid], function(err,row) {
            if (row === undefined) {
              viewers_db.run("INSERT INTO viewers(userid,username,base_address,base_status,updated_at) VALUES(?,?,?,1,datetime('now'))", [userid, username, address], (err) => {
                if (err) {
                  reject(err.message);
                }
                else {
                  resolve('success');
                }
              });
            }
            else {
              viewers_db.run("UPDATE viewers SET username = ?, base_address = ?, updated_at = datetime('now') WHERE userid = ?", [username, address, userid], (err) => {
                if (err) {
                  reject(err.message);
                }
                else {
                  resolve('success');
                }
              });
            }
          });
        });
      }
      else {
        reject('base address is not valid');
      }
    })();
  });
}

const getBaseAddressByUsername = (username) => {
  return new Promise ((resolve, reject) => {
    viewers_db.get("SELECT * FROM viewers WHERE username = ?", [username], function(err,row) {
      if (row === undefined) {
        resolve(false);
      }
      else {
        if (row.base_address != undefined) {
          resolve(row.base_address);
        }
        else {
          resolve(false);
        }
      }
      if (err) {
        reject(err.message);
      }
    });
  });
}

const processBaseEthRain = (channel, username, amount) => {
  var base_rain_error = 0;
  var valid_addresses = [];
  return new Promise (async (resolve, reject) => {
    try {
      let chatters = await getTwitchChatters(channel);
      for (var i = 0; i < chatters.length; i++) {
        let viewer_address = await getBaseAddressByUsername(chatters[i]);
        if (viewer_address != false && chatters[i] != channel) {
          valid_addresses.push(viewer_address);
        }
      }
      if (valid_addresses.length <= 0) {
        resolve('@' + username + ' no valid, active viewers found');
        return;
      }
      else {
        var split = amount / valid_addresses.length;
        (async () => {
          for(var i = 0; i < valid_addresses.length; i++) {
            try {
              await sendBaseEth(valid_addresses[i], split);
              await sleep(250);
            }
            catch (error) {
              base_rain_error = 1;
            }
          }
          if (base_rain_error == 0)
            twitchClient.say(channel,'@' + username + ' ' + roundSplit(split) + ' ETH sent to each valid, active viewer');
          else
            twitchClient.say(channel,'@' + username + ' insufficient gas');
        })();
        if (valid_addresses.length > 1)
          resolve('@' + username + ' raining ' + amount + ' ETH to ' + valid_addresses.length + ' valid, active viewers...');
        else
          resolve('@' + username + ' raining ' + amount + ' ETH to ' + valid_addresses.length + ' valid, active viewer...');
      }
    }
    catch (error) {
      resolve('@' + username + ' ' + error);
    }
  });
}

const processBaseUsdcRain = (channel, username, amount) => {
  var base_rain_error = 0;
  var valid_addresses = [];
  return new Promise (async (resolve, reject) => {
    try {
      let chatters = await getTwitchChatters(channel);
      for (var i = 0; i < chatters.length; i++) {
        let viewer_address = await getBaseAddressByUsername(chatters[i]);
        if (viewer_address != false && chatters[i] != channel) {
          valid_addresses.push(viewer_address);
        }
      }
      if (valid_addresses.length <= 0) {
        resolve('@' + username + ' no valid, active viewers found');
        return;
      }
      else {
        var split = amount / valid_addresses.length;
        (async () => {
          for(var i = 0; i < valid_addresses.length; i++) {
            try {
              await sendBaseUsdc(valid_addresses[i], split);
              await sleep(250);
            }
            catch (error) {
              base_rain_error = 1;
            }
          }
          if (base_rain_error == 0)
            twitchClient.say(channel,'@' + username + ' ' + roundSplit(split) + ' USDC sent to each valid, active viewer');
          else
            twitchClient.say(channel,'@' + username + ' insufficient gas');
        })();
        if (valid_addresses.length > 1)
          resolve('@' + username + ' raining ' + amount + ' USDC to ' + valid_addresses.length + ' valid, active viewers...');
        else
          resolve('@' + username + ' raining ' + amount + ' USDC to ' + valid_addresses.length + ' valid, active viewer...');
      }
    }
    catch (error) {
      resolve('@' + username + ' ' + error);
    }
  });
}

const roundSplit = (split) => {
  if (split >= 0.1) {
    return Math.floor(split * 100) / 100;
  }
  else if (split < 0.1) {
    var zeroes = -Math.floor( Math.log(split) / Math.log(10) + 1);
    var multiplier = 100 * Math.pow(10, zeroes);
    return Math.floor(split * multiplier) / multiplier;
  }
}

const processMessage = (channel, message, username, user_id) => {
  if (message.startsWith('$') || message.startsWith('!'))
    message = message.substr(1);
  else
    return;

  if (message.startsWith('beth ')) {
    if (twitchChannel != username)
      return;
    var amount = parseFloat(message.split(' ')[1]);
    if (amount < 0 || isNaN(amount)) {
      twitchClient.say(channel, username + ' amount has to be greater than 0');
      return;
    }
    var address = message.split(' ')[2];
    if (address == null) {
      twitchClient.say(channel, '@' + username + ' recipient is required');
      return;
    }
    (async() => {
      try {
        var recipient = address;
        if (address.startsWith('@')) {
          recipient = address.substr(1);
        }
        recipient = recipient.toLowerCase();
        let baseAddress = await getBaseAddressByUsername(recipient);
        if (baseAddress == false) {
          twitchClient.say(channel, '@' + username + ' no base address is set');
          return;
        }
        var status = await sendBaseEth(baseAddress, amount);
        twitchClient.say(channel, amount + ' ETH sent to ' + address);
      }
      catch (error) {
        twitchClient.say(channel, '@' + username + ' ' + error);
      }
    })();
    return;
  }
  else if (message.startsWith('bethrain ') || message.startsWith('bethrian ')) {
    if (twitchChannel != username)
      return;
    var amount = parseFloat(message.split(' ')[1]);
    if (amount < 0 || isNaN(amount)) {
      twitchClient.say(channel, '@' + username + ' amount has to be greater than 0');
      return;
    }
    (async() => {
      try {
        let balance = await getBaseEthBalance(signer.address);
        if (parseFloat(amount) <= parseFloat(balance)) {
          let reply = await processBaseEthRain(channel, username, amount);
          twitchClient.say(channel, reply);
        }
        else {
          twitchClient.say(channel, '@' + username + ' insufficient funds');
        }
      }
      catch (error) {
        twitchClient.say(channel, '@' + username + ' ' + error);
      }
    })();
    return;
  }
  if (message.startsWith('busdc ')) {
    if (twitchChannel != username)
      return;
    var amount = parseFloat(message.split(' ')[1]);
    if (amount < 0 || isNaN(amount)) {
      twitchClient.say(channel, username + ' amount has to be greater than 0');
      return;
    }
    var address = message.split(' ')[2];
    if (address == null) {
      twitchClient.say(channel, '@' + username + ' recipient is required');
      return;
    }
    (async() => {
      try {
        let balance = await getBaseUsdcBalance(signer.address);
        if (parseFloat(amount) > parseFloat(balance)) {
          twitchClient.say(channel, '@' + username + ' insufficient funds');
          return;
        }
        var recipient = address;
        if (address.startsWith('@')) {
          recipient = address.substr(1);
        }
        recipient = recipient.toLowerCase();
        let baseAddress = await getBaseAddressByUsername(recipient);
        if (baseAddress == false) {
          twitchClient.say(channel, '@' + username + ' no base address is set');
          return;
        }
        var status = await sendBaseUsdc(baseAddress, amount);
        twitchClient.say(channel, amount + ' USDC sent to ' + address);
      }
      catch (error) {
        twitchClient.say(channel, '@' + username + ' ' + error);
      }
    })();
    return;
  }
  else if (message.startsWith('busdcrain ') || message.startsWith('busdcrian ')) {
    if (twitchChannel != username)
      return;
    var amount = parseFloat(message.split(' ')[1]);
    if (amount < 0 || isNaN(amount)) {
      twitchClient.say(channel, '@' + username + ' amount has to be greater than 0');
      return;
    }
    (async() => {
      try {
        let balance = await getBaseUsdcBalance(signer.address);
        if (parseFloat(amount) <= parseFloat(balance)) {
          let reply = await processBaseUsdcRain(channel, username, amount);
          twitchClient.say(channel, reply);
        }
        else {
          twitchClient.say(channel, '@' + username + ' insufficient funds');
        }
      }
      catch (error) {
        twitchClient.say(channel, '@' + username + ' ' + error);
      }
    })();
    return;
  }
  else if (message == 'base' || message == 'ba') {
    (async() => {
      try {
        let address = await getBaseAddressByUsername(username);
        if (address == false) {
          twitchClient.say(channel, '@' + username + ' no base address is set');
          return;
        }
        else {
          twitchClient.say(channel, '@' + username + ' base address is set to ' + address);
        }
      }
      catch (error) {
        twitchClient.say(channel, '@' + username + ' database is unresponsive');
      }
    })();
    return;
  }
  else if (message.startsWith('base ') || message.startsWith('ba ')) {
    var address = message.split(' ')[1];
    if (address == null) {
      twitchClient.say(channel, '@' + username + ' base address is required');
      return;
    }
    address = address.toLowerCase();
    (async() => {
      try {
        let setAttempt = await setBaseAddress(user_id, username, address);
        twitchClient.say(channel, '@' + username + ' base address is set');
      }
      catch (error) {
        twitchClient.say(channel, '@' + username + ' ' + error);
      }
    })();
    return;
  }
}
