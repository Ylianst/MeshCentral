## Authenticode-JS Video

Nodejs Code Signing module

<div class="video-wrapper">
  <iframe width="320" height="180" src="https://www.youtube.com/embed/xteKscs_Jgo" frameborder="0" allowfullscreen></iframe>
</div>

MeshCentral comes with authenticode.js, you can run it like this:

```bash
node node_modules/meshcentral/authenticode-js
```

and you will get

```
MeshCentral Authenticode Tool.
Usage:
  node authenticode.js [command] [options]
Commands:
  info: Show information about an executable.
        --exe [file]             Required executable to view information.
        --json                   Show information in JSON format.
  sign: Sign an executable.
        --exe [file]             Required executable to sign.
        --out [file]             Resulting signed executable.
        --pem [pemfile]          Certificate & private key to sign the executable with.
        --desc [description]     Description string to embbed into signature.
        --url [url]              URL to embbed into signature.
        --hash [method]          Default is SHA384, possible value: MD5, SHA224, SHA256, SHA384 or SHA512.
        --time [url]             The time signing server URL.
        --proxy [url]            The HTTP proxy to use to contact the time signing server, must start with http://
  unsign: Remove the signature from the executable.
        --exe [file]             Required executable to un-sign.
        --out [file]             Resulting executable with signature removed.
  createcert: Create a code signging self-signed certificate and key.
        --out [pemfile]          Required certificate file to create.
        --cn [value]             Required certificate common name.
        --country [value]        Certificate country name.
        --state [value]          Certificate state name.
        --locality [value]       Certificate locality name.
        --org [value]            Certificate organization name.
        --ou [value]             Certificate organization unit name.
        --serial [value]         Certificate serial number.
  timestamp: Add a signed timestamp to an already signed executable.
        --exe [file]             Required executable to sign.
        --out [file]             Resulting signed executable.
        --time [url]             The time signing server URL.
        --proxy [url]            The HTTP proxy to use to contact the time signing server, must start with http://
  icons: Show the icon resources in the executable.
        --exe [file]               Input executable.
  saveicons: Save an icon group to a .ico file.
        --exe [file]               Input executable.
        --out [file]               Resulting .ico file.
        --icongroup [groupNumber]  Icon groupnumber to save to file.
        --removeicongroup [number]
        --icon [groupNumber],[filename.ico]

Note that certificate PEM files must first have the signing certificate,
followed by all certificates that form the trust chain.

When doing sign/unsign, you can also change resource properties of the generated file.

          --filedescription [value]
          --fileversion [value]
          --internalname [value]
          --legalcopyright [value]
          --originalfilename [value]
          --productname [value]
          --productversion [value]
```

## Automatic Agent Code Signing

If you want to self-sign the mesh agent so you can whitelist the software in your AV, and lock it to your server and organization.

<div class="video-wrapper">
  <iframe width="320" height="180" src="https://www.youtube.com/embed/qMAestNgCwc" frameborder="0" allowfullscreen></iframe>
</div>

!!!note
    If you generate your private key on windows with use `BEGIN PRIVATE KEY` and openssl needs `BEGIN RSA PRIVATE KEY` you can convert your private key to rsa private key using `openssl rsa -in server.key -out server_new.key`

## Setting Agent File info

Now that MeshCentral customizes and signs the agent, you can set that value to anything you like.

```json
"domains": {
      "agentFileInfo": {
            "filedescription": "sample_filedescription",
            "fileversion": "0.1.2.3",
            "internalname": "sample_internalname",
            "legalcopyright": "sample_legalcopyright",
            "originalfilename": "sample_originalfilename",
            "productname": "sample_productname",
            "productversion": "v0.1.2.3"
      }
}
```
