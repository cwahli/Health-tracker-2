const fs = require('fs');
let content = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const targetStr = `                      )}
                    </div>
                  );
                });
              })()}`;

const replacement = `                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        });
      })()}`;

content = content.replace(targetStr, replacement);
fs.writeFileSync('src/components/HomeTab.tsx', content);
