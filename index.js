const { execFile } = require('child_process');
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid/v4');

const ttb_key_path = '/root/certs'
const ttb_private_key_name = 'my-ttb.key.pem'
const ttb_public_key_name = 'my-ttb.pub'

function isTheThingBox(){
  return fs.existsSync(path.join(ttb_key_path, ttb_private_key_name)) && fs.existsSync(path.join(ttb_key_path, ttb_public_key_name))
}

const defaultOption = {
  ttb_crypto: path.join(__dirname, 'bin', 'ttb-crypto'),
  algo: 'aes-256-gcm',
  key_path: '/root/certs',
  private_key: (isTheThingBox() === true)?ttb_private_key_name:null,
  public_key: (isTheThingBox() === true)?ttb_public_key_name:null,
  hydra_exec: {
    base_topic: 'hydra_exec',
    host: 'localhost',
    port: 1883
  }
}

function run(cmd, option, callback){
  if((callback === undefined || callback === null) && typeof option === 'function') {
    callback = option
    option = null
  }

  if(typeof callback !== 'function'){
    callback = (error, stdout, stderr) => {
      console.error(`----------------`)
      if(error){
        console.error(`error : ${error}`)
      }
      if(stdout){
        console.error(`stdout : ${stdout}`)
      }
      if(stderr){
        console.error(`stderr : ${stderr}`)
      }
    }
  }

  if(option === undefined || option === null) {
    option = {}
  }
  option = Object.assign(option, defaultOption)
  if(option.private_key === undefined || option.private_key === null || option.public_key === undefined || option.public_key === null) {
    console.error(`option error: missing rsa key`)
    return
  }

  var client  = mqtt.connect('mqtt://test.mosquitto.org')

  var payload = JSON.stringify({cmd})
  payload = payload.replace(/"/g, '\"')

  var cmdEncrypt = ['-action=encrypt', `-algo=${option.algo}`, `-private_key=${path.join(option.key_path, option.private_key)}`, `-public_key=${path.join(option.key_path, option.public_key)}`, `-text=${payload}`]
  var cmdDecrypt = ['-action=decrypt', `-algo=${option.algo}`, `-private_key=${path.join(option.key_path, option.private_key)}`, `-public_key=${path.join(option.key_path, option.public_key)}`]

  var opt = {
    encoding: 'utf8',
    timeout: 0,
    maxBuffer: 200 * 1024,
    killSignal: 'SIGTERM',
    cwd: null,
    env: null
  }

  var sout
  var serr
  var serror
  var type = 'cmd'

  execFile(option.ttb_crypto, cmdEncrypt, opt, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`)
      return;
    }
    if(!stdout && stderr){
      console.log(`crypto error: ${stderr}`)
      return
    } else {
      var client = mqtt.connect(`mqtt://${option.hydra_exec.host}:${option.hydra_exec.port}`)
      var id = uuid()
      client.on('connect', function () {
        client.subscribe(`${option.hydra_exec.base_topic}/out`)
        client.publish(`${option.hydra_exec.base_topic}/in`, JSON.stringify({
          id,
          type,
          keyname: option.public_key,
          payload: stdout
        }))
      })
       
      client.on('message', function (topic, message) {
        try{
          message = JSON.parse(message.toString())
        } catch(e) {
          message = {}
        }
        if(message.id && message.id === id){
          client.end()
          if(message.error){
            callback(message.error)
            return
          }
          cmdDecrypt[cmdDecrypt.length] = `-text=${message.payload}`
          execFile(option.ttb_crypto, cmdDecrypt, opt, (error2, stdout2, stderr2) => {            
            if (error2) {
              console.error(`exec error: ${error2}`)
              return;
            }

            if(!stdout2 && stderr2){
              console.log(`crypto error: ${stderr2}`)
              return
            } else {
              try{
                resp = JSON.parse(stdout2)
                callback(null, resp.stdout, resp.stderr)
              } catch(e) {}
            }
          })
        }
      })
    }
  })
}

module.exports = run