const mysql = require('mysql2');
const { Client } = require('ssh2');
const {logger} = require('./../plugins/logger')

const handler = async (job) => {
  const vmname = job.data;
  console.log(vmname)


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

    try {
        sshClient.on('ready', () => {
            sshClient.forwardOut(
                forwardConfig.srcHost,
                forwardConfig.srcPort,
                forwardConfig.dstHost,
                forwardConfig.dstPort,
                (err, stream) => {
                    if (err) {
                        logger.error('Error establishing SSH connection:', err);
                        return;
                    }

                    const updatedDbServer = {
                        ...dbServer,
                        stream
                    };

                    const connection = mysql.createConnection(updatedDbServer);

                    connection.connect((error) => {
                        if (error) {
                            logger.error('Error connecting to MySQL:', error);
                            return;
                        }

                
                        const selectQuery = 'SELECT entity_id FROM guacamole_entity WHERE name = ?';
                        connection.query(selectQuery, [vmname], (selectError, selectResults) => {
                            if (selectError) {
                                logger.error('Error executing SELECT query:', selectError);
                                return;
                            }

                            const entityId = selectResults[0]?.entity_id;

                            const selectConnectionIdQuery = `
                                SELECT connection_id 
                                FROM guacamole_connection
                                WHERE connection_name in ("${vmname} (rdp)", "${vmname} (ssh)")
                            `;
                            connection.query(selectConnectionIdQuery, (selectError, selectResults) => {
                                if (selectError) {
                                    logger.error('Error executing SELECT connection query:', selectError);
                                    return;
                                }

                                const connectionIds = selectResults.map(result => result.connection_id);

                                const deleteQuery1 = "DELETE FROM guacamole_entity WHERE name = ?";
                                const deleteQuery2 = "DELETE FROM guacamole_user WHERE entity_id = ?";
                                const deleteQuery3 = "DELETE FROM guacamole_connection WHERE connection_id IN (?)";
                                const deleteQuery4 = "DELETE FROM guacamole_connection_parameter WHERE connection_id IN (?)";
                                const deleteQuery5 = "DELETE FROM guacamole_connection_permission WHERE connection_id IN (?)";

                                const queries = [
                                    { query: deleteQuery1, params: [vmname] },
                                    { query: deleteQuery2, params: [entityId] },
                                    { query: deleteQuery3, params: [connectionIds] },
                                    { query: deleteQuery4, params: [connectionIds] },
                                    { query: deleteQuery5, params: [connectionIds] }
                                ];

                                queries.forEach(({ query, params }) => {
                                    connection.query(query, params, (error, success) => {
                                        if (error) {
                                            logger.error('Error executing query:', error);
                                        } else {
                                        }
                                    });
                                });
                            });
                        });
                    });
                }
            );
        }).connect(tunnelConfig);

    } catch (error) {
        logger.error('Unhandled error:', error);
    }

}

  
  module.exports = handler;
  
  
