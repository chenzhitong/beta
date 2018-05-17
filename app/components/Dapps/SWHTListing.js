import React, { Component } from "react";
import { connect } from "react-redux";
import axios from "axios";
import numeral from "numeral";
import { Link } from "react-router";
import { shell, clipboard } from "electron";

import swhLogo from "../../img/swh.png";
import { setMarketPrice, resetPrice } from "../../modules/wallet";
import { initiateGetBalance, intervals } from "../../components/NetworkSwitch";

const openExplorer = srcLink => {
  shell.openExternal(srcLink);
};

class SWHTListing extends Component {
	constructor(props) {
		super(props);
		this.state = {
			gasPrice: 0,
		};

	}

	render() {
		return (

			<div
			onClick={() =>
			openExplorer("https://switcheo.exchange/tokenswap")
			}
			>
				<div className="col-3 center">
				<div>
				<img
					src={swhLogo}
					alt=""
					height="72"
					className="port-logos pointer flipInY"
				/>
				</div>
				<div className="clearboth" />
				<div className="row top-20" />
				<h3>Switcheo Token Swap</h3>
				Swap your SWH for SWHT Tokens<br />
				<div className="clearboth" />
				</div>
			</div>
		);
	}
}

const mapStateToProps = state => ({
});

SWHTListing = connect(mapStateToProps)(SWHTListing);
export default SWHTListing;
