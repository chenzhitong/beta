import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router";
import Neon from "@cityofzion/neon-js";
import { doSendAsset, verifyAddress } from "neon-js";
import { api, wallet, sc, rpc, u } from "@cityofzion/neon-js";
//import Modal from "react-bootstrap-modal";
import Modal from "react-modal";
import axios from "axios";
import SplitPane from "react-split-pane";
import ReactTooltip from "react-tooltip";
import { log } from "../../util/Logs";
import tncLogo from "../../img/tnc.png";
import Assets from "./../Assets";
import { clipboard } from "electron";
import { togglePane } from "../../modules/dashboard";
import {
  sendEvent,
  clearTransactionEvent,
  toggleAsset
} from "../../modules/transactions";
import { ASSETS, TOKENS, TOKENS_TEST } from "../../core/constants";
import { flatMap, keyBy, get, omit, pick } from "lodash";
import numeral from "numeral";
import TNCChart from "./../NepCharts/TNCChart";
import NEPQRModalButton from "./../Assets/NEPQRModalButton.js";
import TopBar from "./../TopBar";
import Search from "./../Search";
let sendAddress, sendAmount, confirmButton, scriptHash, tnc_usd, gas_usd;

const styles = {
    overlay: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)"
    },
    content: {
        margin: "100px auto 0",
        padding: "30px 30px 30px 30px",
        border: "4px solid #222",
        background: "rgba(12, 12, 14, 1)",
        borderRadius: "20px",
        top: "100px",
        height: 260,
        width: 600,
        left: "100px",
        right: "100px",
        bottom: "100px",
        boxShadow: "0px 10px 44px rgba(0, 0, 0, 0.45)"
    }
};

const apiURL = val => {
  return "https://min-api.cryptocompare.com/data/price?fsym=TNC&tsyms=USD";
};

const apiURLForGas = val => {
  return "https://min-api.cryptocompare.com/data/price?fsym=GAS&tsyms=USD";
};

const isToken = symbol => {
  ![ASSETS.NEO, ASSETS.GAS].includes(symbol);
};
// form validators for input fields
const validateForm = (dispatch, tnc_balance) => {
  // check for valid address
  try {
    if (
      verifyAddress(sendAddress.value) !== true ||
      sendAddress.value.charAt(0) !== "A"
    ) {
      dispatch(sendEvent(false, "The address you entered was not valid."));
      setTimeout(() => dispatch(clearTransactionEvent()), 1000);
      return false;
    }
  } catch (e) {
    dispatch(sendEvent(false, "The address you entered was not valid."));
    setTimeout(() => dispatch(clearTransactionEvent()), 1000);
    return false;
  }
  // check for fractional neo
  if (
    parseInt(sendAmount.value) > tnc_balance) {
    // check for value greater than account balance
    dispatch(sendEvent(false, "You do not have enough TNC to send."));
    setTimeout(() => dispatch(clearTransactionEvent()), 1000);
    return false;
  } else if (parseFloat(sendAmount.value) <= 0) {
    // check for negative asset
    dispatch(sendEvent(false, "You cannot send negative amounts of TNC."));
    setTimeout(() => dispatch(clearTransactionEvent()), 1000);
    return false;
  }
  return true;
};

// open confirm pane and validate fields
const openAndValidate = (dispatch, neo_balance, gas_balance, asset) => {
  if (validateForm(dispatch, neo_balance, gas_balance, asset) === true) {
    dispatch(togglePane("confirmPane"));
  }
};

const extractAssets = sendEntries => {
  //: Array<SendEntryType>
  return sendEntries.filter(({ symbol }) => !isToken(symbol));
};

const buildIntents = sendEntries => {
  //: Array<SendEntryType>
  const assetEntries = extractAssets(sendEntries);
  // $FlowFixMe
  return flatMap(assetEntries, ({ address, amount, symbol }) =>
    api.makeIntent(
      {
        [symbol]: Number(amount)
      },
      address
    )
  );
};

const buildIntentsForInvocation = (
  sendEntries, //: Array<SendEntryType>,
  fromAddress
) => {
  //const intents = buildIntents(sendEntries)
  const intents = [];
  console.log("intents = " + JSON.stringify(intents));

  if (intents.length > 0) {
    return intents;
  } else {
    return buildIntents([
      {
        address: fromAddress,
        amount: "0.00000001",
        symbol: ASSETS.GAS
      }
    ]);
  }
};

const buildTransferScript = (
  net,
  sendEntries, //: Array<SendEntryType>,
  fromAddress,
  tokensBalanceMap //: {
  //     [key: string]: TokenBalanceType
  // }
) => {
  // const tokenEntries = extractTokens(sendEntries);
  //console.log("tokenEntries = " + tokenEntries);
  const fromAcct = new wallet.Account(fromAddress);
  console.log("fromAcct = " + JSON.stringify(fromAcct));
  const scriptBuilder = new sc.ScriptBuilder();
  console.log("scriptBuilder = " + scriptBuilder);

  sendEntries.forEach(({ address, amount, symbol }) => {
    const toAcct = new wallet.Account(address);
    console.log("toAcct = " + JSON.stringify(toAcct));
    const scriptHash = tokensBalanceMap[symbol].scriptHash;
    console.log("Script Hash = " + scriptHash);
    const decimals = tokensBalanceMap[symbol].decimals;
    console.log("decimals = " + decimals);
    const args = [
      u.reverseHex(fromAcct.scriptHash),
      u.reverseHex(toAcct.scriptHash),
      sc.ContractParam.byteArray(Number(amount), "fixed8", decimals)
    ];

    scriptBuilder.emitAppCall(scriptHash, "transfer", args);
  });

  return scriptBuilder.str;
};

const makeRequest = (sendEntries, config) => {
  //: Array<SendEntryType> ,: Object
  console.log("config = " + JSON.stringify(config));
  const script = buildTransferScript(
    config.net,
    sendEntries,
    config.address,
    config.tokensBalanceMap
  );

  console.log("buildTransferScript = " + script);
  return api.doInvoke({
    ...config,
    intents: buildIntentsForInvocation(sendEntries, config.address),
    script,
    gas: 0
  });
};

// perform send transaction for TNC
const sendTncTransaction = async (dispatch, net, selfAddress, wif) => {
  const endpoint = await api.neoscan.getRPCEndpoint(net);
  console.log("endpoint = " + endpoint);
  let script;
  if (net == "MainNet") {
    script = TOKENS.TNC;
  } else {
    script = TOKENS_TEST.TNC;
  }
  const token_response = await api.nep5.getToken(endpoint, script, selfAddress);
  const tnc_balance = token_response.balance;
  console.log("token_response = " + JSON.stringify(token_response));
  const tokenBalances = {
    name: token_response.name,
    symbol: token_response.symbol,
    decimals: token_response.decimals,
    totalSupply: token_response.totalSupply,
    balance: token_response.balance,
    scriptHash: script
  };
  const tokensBalanceMap = {
    TNC: tokenBalances
  }; //keyBy(tokenBalances, 'symbol');
  console.log("tokensBalanceMap = " + JSON.stringify(tokensBalanceMap));
  let privateKey = new wallet.Account(wif).privateKey;
  let publicKey = wallet.getPublicKeyFromPrivateKey(privateKey);
  console.log("public Key = " + publicKey);
  //sendEntries ,// Array<SendEntryType>,
  let sendEntries = new Array();
  var sendEntry = {
    amount: sendAmount.value.toString(),
    address: sendAddress.value.toString(),
    symbol: "TNC"
  };
  sendEntries.push(sendEntry);
  console.log("sendEntries = " + JSON.stringify(sendEntries));
  if (validateForm(dispatch, tnc_balance) === true) {
      if (tnc_balance <= sendAmount.value) {
          dispatch(sendEvent(false, "You are trying to send more TNC than you have available."));
          setTimeout(() => dispatch(clearTransactionEvent()), 2000);
          return true;
      } else {
          dispatch(sendEvent(true, "Sending TNC...\n"));
          try {
              const { response } = await makeRequest(sendEntries, {
                  net,
                  tokensBalanceMap,
                  address: selfAddress,
                  undefined,
                  privateKey: privateKey,
                  signingFunction: null
              });
              console.log("sending tnc response=" + response.result);
              if (!response.result) {
                  dispatch(sendEvent(false, "Sorry, your transaction failed. Please try again soon."));
                  setTimeout(() => dispatch(clearTransactionEvent()), 2000);
              } else {
                  dispatch(sendEvent(true,
                      "Transaction complete! Your balance will automatically update when the blockchain has processed it." ));
                  setTimeout(() => dispatch(clearTransactionEvent()), 2000);
              }
          } catch (err) {
              console.log("sending tnc =" + err.message);
              dispatch(sendEvent(false, "There was an error processing your trasnaction. Please check and try again."));
              setTimeout(() => dispatch(clearTransactionEvent()), 2000);
              return false;
          }
      }
  }
};

const StatusMessage = ({ sendAmount, sendAddress, handleCancel, handleConfirm }) => {
    let message = null;
    message = (
        <Modal
            isOpen={true}
            closeTimeoutMS={5}
            style={styles}
            contentLabel="Modal"
            ariaHideApp={false}
        >
          <div>
            <div className="center modal-alert">
            </div>
            <div className="center modal-alert top-20">
              <strong>Confirm sending {sendAmount} TNC to {sendAddress}</strong>
            </div>
            <div className="row top-30">
              <div className="col-xs-6">
                <button className="cancel-button" onClick={handleCancel}>Cancel</button>
              </div>
              <div className="col-xs-6">
                <button className="btn-send" onClick={handleConfirm}>Confirm</button>
              </div>
            </div>
          </div>
        </Modal>
    );
    return message;
};


class SendTNC extends Component {
  constructor(props) {
    super(props);
    this.state = {
      open: true,
      gas: "0",
      neo: "0",
      neo_usd: "0",
      gas_usd: "0",
      value: "0",
      tncPrice: 0,
      inputEnabled: true,
      fiatVal: 0,
      tokenVal: 0,
      modalStatus: false
    };
    this.handleChange = this.handleChange.bind(this);
    this.handleChangeUSD = this.handleChangeUSD.bind(this);
  }

  async componentDidMount() {
    let neo = await axios.get(apiURL("NEO"));
    let gas = await axios.get(apiURL("GAS"));
    neo = neo.data.USD;
    gas = gas.data.USD;
    this.setState({ neo: neo, gas: gas });
  }

  handleChange(event) {
    this.setState({ value: event.target.value }, (sendAmount = value));
    const value = event.target.value * this.state.neo;
    this.setState({ fiatVal: value });
  }

  async handleChangeUSD(event) {
    this.setState({ fiatVal: event.target.value });
    let gas = await axios.get(apiURL("GAS"));
    gas = gas.data.USD;
    this.setState({ gas: gas });
    const value = this.state.fiatVal / this.state.gas;
    this.setState({ value: value }, () => {
      sendAmount = value;
    });
  }

  render() {
    const {
      dispatch,
      wif,
      address,
      status,
      neo,
      gas,
      net,
      confirmPane,
      selectedAsset,
      tnc
    } = this.props;

    return (
      <div>
          {
              this.state.modalStatus?
                  <StatusMessage
                      sendAmount={sendAmount.value}
                      sendAddress={sendAddress.value}
                      handleCancel = {
                          () => {
                              this.setState({
                                  modalStatus: false
                              })
                          }
                      }
                      handleConfirm ={() => {
                          sendTncTransaction(
                              dispatch, net, address, wif)
                          this.setState({
                              modalStatus: false
                          })
                      }}
                  />
                  :
                  null
          }
          <div className="breadBar">
          <div className="col-flat-10">
          <ol id="no-inverse" className="breadcrumb">

          <li><Link to="/assetPortfolio">Portfolio</Link></li>
          <li className="active">Trinity</li>
          </ol>
          </div>

          <div className="col-flat-2">
          <Search />
          </div>
          </div>

        <TopBar />
        <div id="send">
          <div className="row dash-panel">
            <div className="col-xs-5">
              <img
                src={tncLogo}
                alt=""
                width="54"
                className="neo-logo fadeInDown"
              />
              <h2>Trinity Network</h2>
              <hr className="dash-hr-wide" />
              <span className="market-price"> {numeral(this.props.marketTNCPrice).format("$0,0.00")} each</span><br />
              <span className="font24">{numeral(
                Math.floor(this.props.tnc * 100000) / 100000
              ).format("0,0[.][0000]")} <span id="no-inverse" className="hp-price"> TNC</span></span><br />
              <span className="market-price">{numeral(this.props.tnc * this.props.marketTNCPrice).format("$0,0.00")} USD</span>
            </div>

            <div className="col-xs-7 center">
            <TNCChart />
            </div>

            <div className="col-xs-12 center">
              <hr className="dash-hr-wide top-20" />
            </div>

            <div className="clearboth" />

            <div className="top-20">
              <div className="col-xs-9">
                <input
                  className="form-send-hp"
                  id="center"
                  placeholder="Enter a valid TNC public address here"
                  ref={node => {
                    sendAddress = node;
                  }}
                />
              </div>
              <Link>
              <div className="col-xs-3">
              <NEPQRModalButton />
              </div>
							</Link>

              <div className="col-xs-5 top-20">
                <input
                  className="form-send-hp"
                  type="number"
                  id="assetAmount"
                  min="1"
                  onChange={this.handleChange}
                  value={this.state.value}
                  placeholder="Enter amount to send"
                  ref={node => {
                    sendAmount = node;
                  }}
                />
                <div className="clearboth" />
                <span className="com-soon block top-10">
                  Amount in TNC to send
                </span>
              </div>
              <div className="col-xs-4 top-20">
                <input
                  className="form-send-hp"
                  id="sendAmount"
                  onChange={this.handleChangeUSD}
                  placeholder="Amount in US"
                  value={`${this.state.fiatVal}`}
                />
                <label className="amount-dollar">$</label>
                <div className="clearboth" />
                <span className="com-soon block top-10">Calculated in USD</span>
              </div>
              <div className="col-xs-3 top-20">
                <div id="sendAddress">
                  <button
                    className="pink-button"
                    onClick={() => {
                        if (sendAddress.value === '') {
                            dispatch(sendEvent(false, "Please enter a valid address."));
                            setTimeout(() => dispatch(clearTransactionEvent()), 1000);
                            return false;
                        }


                        if (parseFloat(sendAmount.value) <= 0) {
                            dispatch(sendEvent(false, "You cannot send negative amounts of an TNC."));
                            setTimeout(() => dispatch(clearTransactionEvent()), 1000);
                            return false;
                        }

                        this.setState({
                            modalStatus: true
                        })
                    }
                    }
                    ref={node => {
                      confirmButton = node;
                    }}
                  >
                    <span className="glyphicon glyphicon-send marg-right-5" />{" "}
                    Send
                  </button>
                </div>
              </div>
            </div>

          <div className="clearboth" />
          <div className="send-notice">
            <p>
              Sending Trinity Network (TNC) NEP5 tokens require a balance of 0.00000001 GAS+. Only send TNC to a valid address that supports NEP5+ tokens on the NEO blockchain. When sending TNC to an exchange please ensure the address supports TNC tokens.
            </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({
  blockHeight: state.metadata.blockHeight,
  wif: state.account.wif,
  address: state.account.address,
  net: state.metadata.network,
  neo: state.wallet.Neo,
  gas: state.wallet.Gas,
  marketTNCPrice: state.wallet.marketTNCPrice,
  selectedAsset: state.transactions.selectedAsset,
  confirmPane: state.dashboard.confirmPane,
  tnc: state.wallet.Tnc
});

SendTNC = connect(mapStateToProps)(SendTNC);

export default SendTNC;
