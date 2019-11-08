"""
    Home-Connect
    ~~~~~~~~~~~~~~
    The template for this file was taken from Bruno Rocha
    GitHub: https://github.com/rochacbruno

"""
import json
import time
import os

import requests
from flask import Flask, render_template, request
from flask import redirect, url_for, session
from flask_oauthlib.client import OAuth
from wtforms import Form, SelectField

with open('secrets.json') as secret_file:
    secrets = json.load(secret_file)

app = Flask(__name__)
app.config['ID'] = secrets["ID"]
app.config['SECRET'] = secrets["SECRET"]
app.config["SCOPE"] = secrets["SCOPE"]
app.debug = True
app.secret_key = 'development'
oauth = OAuth(app)

hc = oauth.remote_app(
    'homebridge-wol',
    consumer_key=app.config.get('ID'),
    consumer_secret=app.config.get('SECRET'),
    request_token_params={
        'scope': app.config.get("SCOPE")
    },
    base_url='https://api.home-connect.com',
    request_token_url=None,
    access_token_method='POST',
    access_token_url='https://api.home-connect.com/security/oauth/token',
    authorize_url='https://api.home-connect.com/security/oauth/authorize',
)


class ReusableForm(Form):
    dropdown = SelectField(label="aaa", choices=[])


@app.route('/')
def index():
    return redirect(url_for('welcome'))


@app.route("/welcome", methods=["GET", "POST"])
def welcome():
    if request.method == "POST":
        return redirect(url_for("login"))
    return render_template("welcome.html")


@app.route('/login')
def login():
    print(url_for('authorized', _external=True))
    return hc.authorize(callback=url_for('authorized', _external=True))


@app.route('/logout')
def logout():
    session.pop('hc_token', None)
    return redirect(url_for('index'))


@app.route('/login/authorized')
def authorized():
    resp = hc.authorized_response()
    if resp is None:
        return 'Access denied: reason=%s error=%s' % (
            request.args['error_reason'],
            request.args['error_description']
        )
    session['hc_token'] = (resp['access_token'], '')
    resp["client_id"] = app.config["ID"]
    resp["client_secret"] = app.config["SECRET"]
    resp['timestamp'] = time.time()
    os.umask(0)
    with open(os.open('token.json', os.O_CREAT | os.O_WRONLY, 0o777), 'w') as fp:
        json.dump(resp, fp)

    headers = {"accept": "application/vnd.bsh.sdk.v1+json", "Content-Type": "application/x-www-form-urlencoded",
               "authorization": "Bearer " + resp["access_token"]}
    b = requests.get("https://api.home-connect.com/api/homeappliances", headers=headers)
    app.res = json.loads(b.content)
    app.devices = [(i["haId"], i["brand"] + " " + i["name"] + ", " + i["haId"]) for i in
                   app.res["data"]["homeappliances"]]
    ReusableForm.dropdown = SelectField("Machines", choices=app.devices)
    f = ReusableForm()
    return render_template('form.html', form=f)


@app.route("/finish", methods=["POST"])
def finish():
    haId = request.form['dropdown']
    name = ""
    for i in app.res["data"]["homeappliances"]:
        if i["haId"] == haId:
            name = i["brand"] + " " + i["name"]

    output = {"accessory": "HCDevice",
              "name": name,
              "tokenPath": os.getcwd() + "/token.json",
              "haId": haId}
    return render_template("finished.html", content=json.dumps(output))


@hc.tokengetter
def get_hc_oauth_token():
    return session.get('hc_token')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)
