"""
    Home-Connect
    ~~~~~~~~~~~~~~
    The template for this file was taken from Bruno Rocha
    GitHub: https://github.com/rochacbruno

"""
import json
import time

from flask import Flask, redirect, url_for, session, request
from flask_oauthlib.client import OAuth

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


@app.route('/')
def index():
    if 'hc_token' in session:
        return hc.name
    return redirect(url_for('login'))


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
    with open('token.json', 'w') as fp:
        json.dump(resp, fp)

    return "You can close this page now."


@hc.tokengetter
def get_hc_oauth_token():
    return session.get('hc_token')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)
