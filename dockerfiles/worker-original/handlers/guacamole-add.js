const mysql = require('mysql2');
const { Client } = require('ssh2');

const handler = async (job) => {
  try {
    const { adminUsername, adminPassword, os, publicIp, vmName } = job.data;
      const publicIpAddress = publicIp
      const machine_type = os
    const staticUsername = adminUsername;

    // Additional parameters
    const usernameParam = staticUsername;
    const connectionProtocol = machine_type === 'Windows' ? 'rdp' : 'ssh';
    const connectionHostname = publicIpAddress;
    const connectionPort = machine_type === 'Windows' ? '3389' : '22';
    const passwordParam = adminPassword;
    const security = 'any';
    const ignoreCert = 'true';
    const colorDepth = 32;
    const enableWallpaper = 'true';

    // Set up database server configuration
    const dbServer = {
        host: '127.0.0.1',
        user: 'root',
        password: 'asdf',
        database: 'guacamole_db',
        port: 3306
    };

    // Set up SSH tunnel configuration
    const tunnelConfig = {
        host: '74.224.126.48',
        port: 22,
        username: 'guacamole',
        password: 'Welcome1234!'
    };

    // Set up port forwarding configuration
    const forwardConfig = {
        srcHost: '127.0.0.1',
        srcPort: 3306,
        dstHost: dbServer.host,
        dstPort: dbServer.port
    };

    // Create an SSH client
    const sshClient = new Client();

    const SSHConnection = new Promise((resolve, reject) => {
        sshClient.on('ready', () => {
            sshClient.forwardOut(
                forwardConfig.srcHost,
                forwardConfig.srcPort,
                forwardConfig.dstHost,
                forwardConfig.dstPort,
                (err, stream) => {
                    if (err) {
                        console.error('Error establishing SSH connection:', err);
                        reject('Error establishing SSH connection');
                        return;
                    }

                    const updatedDbServer = {
                        ...dbServer,
                        stream
                    };

                    const connection = mysql.createConnection(updatedDbServer);

                    connection.connect((error) => {
                        if (error) {
                            console.error('Error connecting to MySQL:', error);
                            reject('Error connecting to MySQL');
                            return;
                        }

                        // Insert data into guacamole_entity table
                        const insertQuery = 'INSERT INTO guacamole_entity (name, type) VALUES (?, "USER")';
                        const values = [vmName];

                        connection.query(insertQuery, values, (insertError, insertResults) => {
                            // Even if the insert query fails, proceed to the SELECT query
                            const selectQuery = 'SELECT entity_id FROM guacamole_entity WHERE name = ?';

                            connection.query(selectQuery, [vmName], (selectError, selectResults) => {

                                const entityId = selectResults[0]?.entity_id;

                                // Proceed to the third query to insert data into guacamole_user

                                const insertUserQuery = `
                                INSERT INTO guacamole_user 
                                (entity_id, password_hash, password_salt, password_date, disabled, expired, timezone, full_name, email_address) 
                                VALUES (?, UNHEX(SHA2(?, 256)), NULL, NOW(), 0, 0, NULL, NULL, NULL)`;

                                const userValues = [
                                    entityId, // entity_id
                                    adminPassword, // password_hash
                                ];

                                connection.query(insertUserQuery, userValues, (userInsertError, userInsertResults) => {
                                   

                                    const connectionName = `${vmName} (${connectionProtocol})`;
                                    const insertConnectionQuery = `
                                        INSERT INTO guacamole_connection (protocol, connection_name) 
                                        VALUES (?, ?)
                                    `;

                                    const connectionValues = [connectionProtocol, connectionName];

                                    connection.query(insertConnectionQuery, connectionValues, (connectionInsertError, connectionInsertResults) => {
                                     
                                        // Retrieve the connection_id
                                     
                                        const selectConnectionIdQuery = 'SELECT connection_id FROM guacamole_connection WHERE connection_name = ?';

                                        connection.query(selectConnectionIdQuery, [connectionName], (selectConnectionIdError, selectConnectionIdResults) => {
                                           

                                            const connectionId = selectConnectionIdResults[0]?.connection_id;
                                     
                                            const insertConnectionParameterQuery = `
                                                INSERT INTO guacamole_connection_parameter 
                                                (connection_id, parameter_name, parameter_value) 
                                                VALUES (?, 'hostname', ?), (?, 'port', ?), (?, 'username', ?), (?, 'password', ?), (?, 'security', ?), (?, 'ignore-cert', ?), (?, 'color-depth', ?), (?, 'enable-wallpaper', ?);
                                            `;

                                            const connectionParameterValues = [
                                                connectionId, connectionHostname, connectionId, connectionPort,
                                                connectionId, usernameParam, connectionId, passwordParam,
                                                connectionId, security, connectionId, ignoreCert,
                                                connectionId, colorDepth, connectionId, enableWallpaper
                                            ];

                                            connection.query(insertConnectionParameterQuery, connectionParameterValues, (connectionParameterInsertError, connectionParameterInsertResults) => {
                            
                                                // Proceed to the final query to insert data into guacamole_connection_permission
                            
                                                const insertConnectionPermissionQuery = `
                                                    INSERT INTO guacamole_connection_permission 
                                                    (entity_id, connection_id, permission) 
                                                    VALUES (?, ?, 'READ');
                                                `;

                                                const connectionPermissionValues = [entityId, connectionId];

                                                connection.query(insertConnectionPermissionQuery, connectionPermissionValues, (connectionPermissionInsertError, connectionPermissionInsertResults) => {
        
                                                    if (machine_type === "Linux") {
                                                    
                                                        const connectionName2 = `${vmName} (rdp)`;
                                                        const insertConnectionQuery = `
                                                            INSERT INTO guacamole_connection (protocol, connection_name) 
                                                            VALUES (?, ?)
                                                        `;
                                                    
                                                        const connectionValues = ["rdp", connectionName2];
                                                    
                                                        connection.query(insertConnectionQuery, connectionValues, (connectionInsertError, connectionInsertResults) => {
                                                    
                                                            // Retrieve the connection_id
                                                    
                                                            const selectConnectionIdQuery = 'SELECT connection_id FROM guacamole_connection WHERE connection_name = ?';
                                                    
                                                            connection.query(selectConnectionIdQuery, [connectionName2], (selectConnectionIdError, selectConnectionIdResults) => {
                                                               
                                                                const connectionId = selectConnectionIdResults[0]?.connection_id;
                                                        
                                                                const insertConnectionParameterQuery = `
                                                                    INSERT INTO guacamole_connection_parameter 
                                                                    (connection_id, parameter_name, parameter_value) 
                                                                    VALUES (?, 'hostname', ?), (?, 'port', ?), (?, 'username', ?), (?, 'password', ?), (?, 'security', ?), (?, 'ignore-cert', ?), (?, 'color-depth', ?), (?, 'enable-wallpaper', ?);
                                                                `;
                                                    
                                                                const connectionParameterValues = [
                                                                    connectionId, connectionHostname, connectionId, "3389",
                                                                    connectionId, usernameParam, connectionId, passwordParam,
                                                                    connectionId, security, connectionId, ignoreCert,
                                                                    connectionId, colorDepth, connectionId, enableWallpaper
                                                                ];
                                                    
                                                                connection.query(insertConnectionParameterQuery, connectionParameterValues, (connectionParameterInsertError, connectionParameterInsertResults) => {
                                                    
                                                                    const insertConnectionPermissionQuery = `
                                                                        INSERT INTO guacamole_connection_permission 
                                                                        (entity_id, connection_id, permission) 
                                                                        VALUES (?, ?, 'READ');
                                                                    `;
                                                    
                                                                    const connectionPermissionValues = [entityId, connectionId];
                                                    
                                                                    connection.query(insertConnectionPermissionQuery, connectionPermissionValues, (connectionPermissionInsertError, connectionPermissionInsertResults) => {
                                                                        connection.end();
                                                                        resolve('Connection and insert completed successfully.');
                                                                    });
                                                                });
                                                            });
                                                        });
                                                    }
                                                    else {
                                                        // Close the connection even if the condition is not met
                                                        connection.end();
                                                        resolve('Connection closed successfully.');
                                                    }
                                                    
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
        }).connect(tunnelConfig);
    });

    return SSHConnection.catch((error) => {
      console.error('Unhandled error during SSH or DB operations:', error);
      return 'Operation completed with errors.';
    });
  } catch (err) {
    console.error('Unhandled error in handler:', err);
    throw err;
  }
};

module.exports = handler;
