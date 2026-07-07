const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const endRegex = /                                  <\/td>\n                                <\/tr>\n                              <\/tbody>\n                            <\/table>\n                          <\/div>\n                        \)\}\n                      <\/div>\n                    \);\n                  \}\)\}\n                <\/div>/g;

const newEnd = `                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                  </div>
                  ))}
                </div>`;

code = code.replace(endRegex, newEnd);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
