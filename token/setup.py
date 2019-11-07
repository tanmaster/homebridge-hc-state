from setuptools import setup

setup(
    name='home-connect-authenticate',
    version='1.0.0',
    packages=['.'],
    url='',
    install_requires=[
        'Flask-OAuthlib',
        'Flask',
        "wtforms",
    ],
    license='MIT',
    author='Tan Yücel',
    author_email='tanmaster95@hotmail.com',
    description='Script to get a token from hc.'
)
