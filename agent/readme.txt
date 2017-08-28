MeshAgent 2.0, 32bit Windows Executable

This is a super early development sample. Agent can't do anything yet. 

Command parameters:
--info   (shows info)
--update-key  (update key, pertinent keys include “MeshServer”, “MeshID”, “ServerID”
--update-key-hex
--delete-key
--dump-key
--dump-key-hex
--mesh-server  (same as doing –update-key MeshServer)

Note: MeshServer, specify uri… For now, use ws:// as it doesn’t connect TLS to server right now, because the Mesh Server I have right now doesn’t do TLS, so I couldn’t test.

Use –update-key-hex to specify MeshID and ServerID
MeshAgent.exe –update-key-hex MeshID 5BFC963FA34940E24C032A43E1AD675EEBF27AD1E4CE24C678D081E8B2725FD9

