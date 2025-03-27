# Amazon Web Services

The following section explains possible ways to install MeshCentral onto Amazon Web Services (AWS) instances.<br>
For reference: [Amazon Web Services](https://aws.amazon.com/).

### Amazon Linux 2

For Amazon EC2 users, that want to manage 100 devices or less. Launch a t3.nano or t3.micro EC2 instance with Amazon Linux 2 with TCP ports 22 (SSH), 80 (HTTP), 443 (HTTPS) and 4433 (CIRA) open.<br>
The difference betweeen the two scripts below is that the first script meant for lightweight instances does not contain an extenral database, therefor it uses its internal NeDB-database.<br>
Then login as `ec2-user` and enter the following commands:

```sh linenums="1"
wget https://meshcentral.com/scripts/mc-aws-linux2.sh
chmod 755 mc-aws-linux2.sh
./mc-aws-linux2.sh
```
> If you want to live on the edge:<br>
> `curl https://meshcentral.com/scripts/mc-aws-linux2.sh | bash`.

This will download the Bash install script and once ran, will install NodeJS, MeshCentral, setup systemd and start the MeshCentral server.<Br>
For a larger instance like a t3.small, t3.medium or larger you can run the following that does the same but also installs MongoDB.

```sh linenums="1"
wget https://meshcentral.com/scripts/mc-aws-linux2-mongo.sh
chmod 755 mc-aws-linux2-mongo.sh
./mc-aws-linux2-mongo.sh
```
> If you want to live on the edge:<br>
> `curl https://meshcentral.com/scripts/mc-aws-linux2-mongo.sh | bash`.

After these scripts are run, try accessing the server using a browser. MeshCentral will take a minute or two to create certificates after that, the server will be up. The first account to be created will be the site administrator – so don’t delay and create an account right away. Once running, move on to the MeshCentral’s user’s guide to configure your new server.